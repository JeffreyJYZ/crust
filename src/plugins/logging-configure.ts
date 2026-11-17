/**
 * `crust:logging`'s runtime repoint, split out of `logging.ts` so the sink stays under the 200-line
 * cap. `log:configure` in Butter picks a new file and level in one call; the file is a write the page
 * chose, so it is checked against the app's data root before anything is opened, the same boundary a
 * download destination uses. A sibling whose name merely starts the root is outside it, and a symlink
 * inside the root that resolves outside it is refused too — a lexical check alone misses both.
 */

import { readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";

import { CrustError } from "../bridge/errors";
import type { LogLevel } from "./logging";

export interface ConfigureArgs {
	/** New live log file, resolved inside the app's data root. */
	file?: string;
	/** New minimum level, one of the five {@link LogLevel} values. */
	level?: LogLevel;
}

export interface ConfigureResult {
	ok: boolean;
	/** The live file after the call, whether or not it was repointed. */
	file?: string;
	/** The level after the call, whether or not it changed. */
	level?: LogLevel;
	/** Why the call was refused; absent when `ok`. */
	error?: string;
}

/** A prefix allows itself and everything under it, never a sibling that merely starts the same. */
function inside(root: string, target: string): boolean {
	if (target === root) return true;
	return target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/** Every existing ancestor replaced by its `realpath`; a missing leaf keeps its written form. */
function canonical(path: string, seen: Set<string> = new Set()): string {
	const absolute = resolve(path);
	try {
		return realpathSync(absolute);
	} catch {
		const parent = dirname(absolute);
		if (parent === absolute || seen.has(absolute)) return absolute;
		let link: string | undefined;
		try {
			link = readlinkSync(absolute);
		} catch {
			link = undefined;
		}
		if (link !== undefined) {
			seen.add(absolute);
			return canonical(resolve(parent, link), seen);
		}
		return resolve(canonical(parent, seen), basename(absolute));
	}
}

/**
 * The absolute file a page may write, or `bad-request` when it is empty, relative or leaves `root`.
 * `resolve` collapses `..` first, so a walk out of the root is refused rather than normalised away.
 */
export function resolveLogFile(root: string, file: string): string {
	if (typeof file !== "string" || file.trim().length === 0) {
		throw new CrustError("bad-request", 'logging.configure: "file" must be a non-empty path');
	}
	if (!isAbsolute(file)) {
		throw new CrustError("bad-request", `logging.configure: ${file} is not an absolute path`);
	}
	const target = resolve(file);
	if (!inside(canonical(root), canonical(target))) {
		throw new CrustError(
			"bad-request",
			`logging.configure: ${target} is outside the app's data root ${root}`,
		);
	}
	return target;
}
