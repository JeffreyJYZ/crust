/**
 * Path arithmetic for `crust:fs`'s scope: the canonical form a comparison is made on, the prefix test,
 * and the argument rule every scope command shares. Kept beside `fs-scope.ts` rather than inside it so
 * each file stays readable in one sitting.
 */

import { readlink, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, sep } from "node:path";

import { CrustError } from "../bridge/errors";

export function outsideScope(path: string): CrustError {
	return new CrustError("outside-scope", `fs: ${path} is outside the app's scope`);
}

/**
 * The real location of a path. A missing leaf resolves through its nearest existing parent, so a check names
 * the directory a write will land in rather than the plain name in front of it.
 *
 * `..` is left in the string for `realpath` to fold the way the OS does. Folding it lexically first would
 * erase a symlink before a `..` (`scope/link/../secret.txt` → `scope/secret.txt`), so the check would name a
 * path inside the grant while the command still follows the link outside it.
 *
 * A **dangling** symlink is the case that makes a parent-only fallback wrong: `realpath` fails because the
 * target is absent, the link's own path is inside the scope, and `Bun.write` then follows the link to a
 * target outside it. So the link itself is read and its target resolved even though nothing is there yet.
 * `seen` bounds a link cycle, which would otherwise recurse forever.
 */
export async function canonical(path: string, seen: Set<string> = new Set()): Promise<string> {
	// Absolute without folding `..`: resolve() would drop the symlink realpath must traverse.
	const absolute = isAbsolute(path) ? path : `${process.cwd()}${sep}${path}`;
	const found = await realpath(absolute).catch(() => undefined);
	if (found !== undefined) return found;
	const parent = dirname(absolute);
	if (parent === absolute) return absolute;
	if (seen.has(absolute)) return absolute;
	const link = await readlink(absolute).catch(() => undefined);
	if (link !== undefined) {
		seen.add(absolute);
		return canonical(isAbsolute(link) ? link : `${parent}${sep}${link}`, seen);
	}
	return join(await canonical(parent, seen), basename(absolute));
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
