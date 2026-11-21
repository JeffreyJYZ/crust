/**
 * Zip-slip: the entries an archive may not contain. A name that is absolute, carries a backslash or
 * climbs with `..` turns "extract into this directory" into "write wherever the archive likes", and a
 * symlink pointing outside the bundle hands the installed app a path out of it.
 * Every refusal names the entry, because "the archive is bad" tells an author nothing, and these run
 * before a byte is written, so nothing is created and then cleaned up.
 */

import { posix } from "node:path";

import type { ArchiveEntry } from "./updater-archive";

/** A refusal about one archive, carrying the entry it is about when there is one. */
export class ArchiveError extends Error {
	readonly entry?: string;

	constructor(message: string, entry?: string) {
		super(message);
		this.name = "ArchiveError";
		this.entry = entry;
	}
}

/** A name is a relative path of plain segments, or the archive is refused. */
export function assertEntryName(name: string): void {
	if (name.length === 0) throw new ArchiveError("has an entry with an empty name");
	if (name.includes("\0")) {
		throw new ArchiveError(`has an entry "${name}" containing a NUL byte`, name);
	}
	if (name.includes("\\")) {
		throw new ArchiveError(`has an entry "${name}" containing a backslash`, name);
	}
	if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
		throw new ArchiveError(`has an entry "${name}" that is an absolute path`, name);
	}
	for (const segment of name.split("/")) {
		if (segment === "..") {
			throw new ArchiveError(`has an entry "${name}" that climbs out with ".."`, name);
		}
	}
}

/** A symlink may point anywhere inside the bundle and nowhere else. */
export function assertLinkInside(entry: ArchiveEntry, root: string): void {
	const target = entry.target ?? "";
	const name = entry.name;
	if (target.length === 0) {
		throw new ArchiveError(`has a symlink "${name}" with an empty target`, name);
	}
	if (target.includes("\0"))
		throw new ArchiveError(`has a symlink "${name}" with a NUL byte`, name);
	if (target.startsWith("/") || /^[A-Za-z]:/.test(target)) {
		throw new ArchiveError(
			`has a symlink "${name}" pointing at the absolute path "${target}"`,
			name,
		);
	}
	const own = posix.dirname(name);
	const resolved = posix.normalize(posix.join(own, target));
	if (resolved !== root && !resolved.startsWith(`${root}/`)) {
		throw new ArchiveError(
			`has a symlink "${name}" pointing outside the archive at "${target}"`,
			name,
		);
	}
	if (resolved === root || resolved === own || own.startsWith(`${resolved}/`)) {
		// A link back to the root or one of its own parents makes `stat` recurse until ELOOP,
		// both while extracting and when the tree digest walks the result.
		throw new ArchiveError(
			`has a symlink "${name}" whose target "${target}" cycles back into the archive`,
			name,
		);
	}
}

/**
 * A later entry below a symlink is written *through* that link — `mkdir` and `writeFile` both
 * follow it — so the tree `install` renames is not the entry list the digest described. Refuse the
 * whole class, whatever order the two entries came in.
 */
export function assertNoSymlinkParents(entries: readonly ArchiveEntry[]): void {
	const links = new Set<string>();
	for (const entry of entries) {
		if (entry.kind === "symlink") links.add(entry.name);
	}
	for (const entry of entries) {
		const segments = entry.name.split("/");
		for (let at = 1; at < segments.length; at += 1) {
			const ancestor = segments.slice(0, at).join("/");
			if (links.has(ancestor)) {
				throw new ArchiveError(
					`has an entry "${entry.name}" below symlink "${ancestor}", so it would be written through the link`,
					entry.name,
				);
			}
		}
	}
}

/** An update is one `.app` directory, so every entry must sit under one top-level name. */
export function archiveRoot(entries: readonly ArchiveEntry[]): string {
	const tops = new Set(entries.map((entry) => entry.name.split("/")[0] ?? ""));
	if (tops.size !== 1) {
		const names = [...tops].map((top) => `"${top}"`).join(", ");
		throw new ArchiveError(
			`holds ${tops.size} top-level entries (${names}), and an update is one .app directory`,
		);
	}
	const [root = ""] = [...tops];
	if (!root.endsWith(".app") || root === ".app") {
		throw new ArchiveError(`holds "${root}", which is not a named .app directory`);
	}
	return root;
}
