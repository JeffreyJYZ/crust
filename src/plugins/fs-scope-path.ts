/**
 * Path arithmetic for `crust:fs`'s scope: the canonical form a comparison is made on, the prefix test,
 * and the argument rule every scope command shares. Kept beside `fs-scope.ts` rather than inside it so
 * each file stays readable in one sitting.
 */

import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

import { CrustError } from "../bridge/errors";

export function outsideScope(path: string): CrustError {
	return new CrustError("outside-scope", `fs: ${path} is outside the app's scope`);
}

/**
 * The real location of a path. A missing leaf resolves through its nearest existing parent, so a check names
 * the directory a write will land in rather than the symlink in front of it.
 */
export async function canonical(path: string): Promise<string> {
	const absolute = resolve(path);
	const found = await realpath(absolute).catch(() => undefined);
	if (found !== undefined) return found;
	const parent = dirname(absolute);
	if (parent === absolute) return absolute;
	return join(await canonical(parent), basename(absolute));
}

/** A prefix allows itself and everything under it, never a sibling whose name merely starts the same. */
export function contains(prefix: string, target: string): boolean {
	if (target === prefix) return true;
	return target.startsWith(prefix.endsWith(sep) ? prefix : `${prefix}${sep}`);
}

/**
 * Whether two canonical paths name the same file. Folded where the filesystem folds: APFS and NTFS resolve
 * `SCOPE.json` and `scope.json` to one file, so a byte-wise compare there is a bypass — the same reason the
 * network matcher folds its URLs. The fold is duplicated from `network-match.ts` on purpose: `fs` must not
 * import a network module to know how its own filesystem compares names.
 */
export function samePath(left: string, right: string): boolean {
	if (left === right) return true;
	if (process.platform !== "darwin" && process.platform !== "win32") return false;
	return left.toLowerCase() === right.toLowerCase();
}

/** The `path` argument a scope command takes: absolute, non-empty, and nothing else. */
export function readPath(args: unknown): string {
	const value = (args as { path?: unknown } | undefined)?.path;
	if (typeof value !== "string" || value.trim() === "") {
		throw new CrustError("bad-request", 'fs.scope: "path" must be a non-empty string');
	}
	if (!isAbsolute(value)) {
		throw new CrustError("bad-request", `fs.scope: ${value} is not an absolute path`);
	}
	return value;
}
