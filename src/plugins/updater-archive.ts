/**
 * The zip half of `crust:updater`'s download: Bun ships a tar reader and no zip reader, and its
 * tar extraction drops the unix mode a bundle's executable needs, so this reads a zip's own
 * central directory and keeps that mode.
 * Nothing here touches a filesystem: the bytes go in, the entries come out, and the escape checks
 * live in `updater-slip`, so every refusal names the entry that caused it.
 */

import { MAX_DOWNLOAD_BYTES } from "./updater-fetch";
import {
	ArchiveError,
	archiveRoot,
	assertEntryName,
	assertLinkInside,
	assertNoSymlinkParents,
} from "./updater-slip";
import { assertRange, END, END_BYTES, findEnd, isZip, LOCAL, viewOf } from "./updater-zip-bytes";

export * from "./updater-slip";
export { isZip } from "./updater-zip-bytes";

export type ArchiveEntryKind = "file" | "directory" | "symlink";
export interface ArchiveEntry {
	/** The entry's path inside the archive, forward slashes, already checked for escape. */
	readonly name: string;
	readonly kind: ArchiveEntryKind;
	/** Unix permission bits, 0 when the archive records none. */
	readonly mode: number;
	/** A file's bytes; absent on a directory and on a symlink. */
	readonly bytes?: Uint8Array;
	/** A symlink's target, as the archive wrote it. */
	readonly target?: string;
}

export interface Archive {
	/** The one top-level `.app` directory every entry sits under. */
	readonly root: string;
	readonly entries: readonly ArchiveEntry[];
}

const CENTRAL = 0x02014b50;
const TYPE_MASK = 0o170000;
const SYMLINK = 0o120000;
const DIRECTORY = 0o040000;

/**
 * The wire cap bounds compressed bytes, not memory: deflate can expand one byte into roughly a
 * thousand. The central directory's uncompressed sizes bound the output before `inflateSync` runs,
 * because Bun's inflate has no `maxOutputLength` option.
 */
export const MAX_INFLATED_BYTES = MAX_DOWNLOAD_BYTES;

const text = new TextDecoder();

function kindOf(name: string, mode: number): ArchiveEntryKind {
	const type = mode & TYPE_MASK;
	if (type === SYMLINK) return "symlink";
	if (type === DIRECTORY || name.endsWith("/")) return "directory";
	return "file";
}

/** A local header's data offset, inflated when the entry is deflated. */
function dataOf(
	bytes: Uint8Array,
	view: DataView,
	at: number,
	size: number,
	method: number,
	declared: number,
): Uint8Array {
	assertRange(view, at, 30, "a local header");
	if (view.getUint32(at, true) !== LOCAL) {
		throw new ArchiveError("has a damaged local header");
	}
	const nameLength = view.getUint16(at + 26, true);
	const extraLength = view.getUint16(at + 28, true);
	const start = at + 30 + nameLength + extraLength;
	assertRange(view, start, size, "an entry's data");
	const raw = bytes.subarray(start, start + size);
	let data: Uint8Array;
	if (method === 0) data = raw;
	else if (method === 8) data = Bun.inflateSync(new Uint8Array(raw), { windowBits: -15 });
	else {
		throw new ArchiveError(
			`uses compression method ${method}, and updater reads stored and deflate`,
		);
	}
	if (data.byteLength > declared) {
		throw new ArchiveError(
			`has an entry inflated to ${data.byteLength} bytes, but its directory declares ${declared}`,
		);
	}
	return data;
}

function readCentral(
	bytes: Uint8Array,
	view: DataView,
	at: number,
	out: ArchiveEntry[],
	budget: { used: number },
): number {
	assertRange(view, at, 46, "a central directory header");
	if (view.getUint32(at, true) !== CENTRAL) {
		throw new ArchiveError("has a damaged central directory");
	}
	if ((view.getUint16(at + 8, true) & 0x1) !== 0) {
		throw new ArchiveError("is encrypted, and updater reads only an unencrypted archive");
	}
	const method = view.getUint16(at + 10, true);
	const size = view.getUint32(at + 20, true);
	const declared = view.getUint32(at + 24, true);
	if (declared > MAX_INFLATED_BYTES - budget.used) {
		throw new ArchiveError(
			`declares ${declared} bytes in one entry, over the ${MAX_INFLATED_BYTES} byte cap for an update`,
		);
	}
	const nameLength = view.getUint16(at + 28, true);
	const extraLength = view.getUint16(at + 30, true);
	const commentLength = view.getUint16(at + 32, true);
	// The unix mode is the high half of the external attributes, and its top bits are the type:
	// masking to the permission bits here would make every symlink read as a file.
	const unix = view.getUint32(at + 38, true) >>> 16;
	const local = view.getUint32(at + 42, true);
	assertRange(view, at + 46, nameLength, "a central directory entry name");
	const name = text.decode(bytes.subarray(at + 46, at + 46 + nameLength));
	const next = at + 46 + nameLength + extraLength + commentLength;
	assertRange(
		view,
		at + 46,
		nameLength + extraLength + commentLength,
		"a central directory entry",
	);
	const kind = kindOf(name, unix);
	const mode = unix & 0o777;
	const data = dataOf(bytes, view, local, size, method, declared);
	budget.used += data.byteLength;
	if (kind === "symlink") out.push({ name, kind, mode, target: text.decode(data) });
	else if (kind === "directory") out.push({ name, kind, mode });
	else out.push({ name, kind, mode, bytes: data });
	return next;
}

/** Read and check every entry, or throw the one refusal that names what is wrong with it. */
export function readArchive(bytes: Uint8Array): Archive {
	const view = viewOf(bytes);
	const end = findEnd(view);
	assertRange(view, end, END_BYTES, "an end-of-central-directory record");
	const count = view.getUint16(end + 10, true);
	const offset = view.getUint32(end + 16, true);
	if (count === 0xffff || offset === 0xffffffff) {
		throw new ArchiveError("is a zip64 archive, which updater does not read");
	}
	if (offset > view.byteLength) {
		throw new ArchiveError(
			`is truncated: its central directory starts at ${offset}, past the ${view.byteLength} bytes it has`,
		);
	}
	const entries: ArchiveEntry[] = [];
	const budget = { used: 0 };
	let at = offset;
	for (let index = 0; index < count; index += 1) {
		at = readCentral(bytes, view, at, entries, budget);
	}
	for (const entry of entries) assertEntryName(entry.name);
	const root = archiveRoot(entries);
	for (const entry of entries) {
		if (entry.kind === "symlink") assertLinkInside(entry, root);
	}
	assertNoSymlinkParents(entries);
	return { root, entries };
}
