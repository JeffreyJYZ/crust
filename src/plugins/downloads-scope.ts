/**
 * Where a download may be written. A destination is a write the page chose, so it is checked here
 * against the app's data root before WebKit ever sees it: a path outside that root is a defect, not
 * a preference, and a sibling whose name merely starts the root is outside it too.
 * A lexical check alone is not enough — a symlink already sitting inside the root resolves outside
 * it — so the containment test runs on the canonical form of both ends.
 */

import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";

import { CrustError } from "../bridge/errors";

/** A non-empty string argument, or `bad-request` naming the command and the field. */
export function requireText(value: unknown, command: string, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new CrustError(
			"bad-request",
			`downloads.${command}: "${field}" must be a non-empty string`,
		);
	}
	return value;
}

/** A prefix allows itself and everything under it, never a sibling that merely starts the same. */
export function inside(root: string, target: string): boolean {
	if (target === root) return true;
	return target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/**
 * The path with every existing ancestor replaced by its `realpath`; a tail that does not exist yet
 * is kept as written, so a destination the app is about to create still resolves. Recursing on the
 * parent is what lets a missing leaf inherit the canonical form of the directory it will land in.
 */
function canonical(path: string): string {
	const absolute = resolve(path);
	try {
		return realpathSync(absolute);
	} catch {
		const parent = dirname(absolute);
		if (parent === absolute) return absolute;
		return resolve(canonical(parent), basename(absolute));
	}
}

/**
 * The absolute destination directory, or `bad-request` when it is relative or leaves `root`.
 * `resolve` collapses `..` first, so a walk out of the root is refused rather than normalised away.
 * The returned path is the one the page asked for, but only after both it and the root were
 * canonicalised: a symlink inside the root that points outside it is refused, not written through.
 */
export function destination(root: string, path: string): string {
	if (!isAbsolute(path)) {
		throw new CrustError(
			"bad-request",
			`downloads.setDirectory: ${path} is not an absolute path`,
		);
	}
	const target = resolve(path);
	if (!inside(canonical(root), canonical(target))) {
		throw new CrustError(
			"bad-request",
			`downloads.setDirectory: ${target} is outside the app's data root ${root}`,
		);
	}
	return target;
}
