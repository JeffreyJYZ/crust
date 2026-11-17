/**
 * The zip half of `crust:updater`'s download: Bun ships a tar reader and no zip reader, and its
 * tar extraction drops the unix mode a bundle's executable needs, so this reads a zip's own
 * central directory and keeps that mode.
 * Nothing here touches a filesystem: the bytes go in, the entries come out, and the escape checks
 * live in `updater-slip`, so every refusal names the entry that caused it.
 */

import { ArchiveError, archiveRoot, assertEntryName, assertLinkInside } from "./updater-slip";

export * from "./updater-slip";

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

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const END_BYTES = 22;
const MAX_COMMENT = 0xffff;
const TYPE_MASK = 0o170000;
const SYMLINK = 0o120000;
const DIRECTORY = 0o040000;

const text = new TextDecoder();

/** Whether these bytes open like a zip: a local header, or the record of an empty archive. */
export function isZip(bytes: Uint8Array): boolean {
	if (bytes.length < 4) return false;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const magic = view.getUint32(0, true);
	return magic === LOCAL || magic === END;
}

function viewOf(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** The end-of-central-directory record sits last, behind a comment of up to 64 KiB. */
function findEnd(view: DataView): number {
	const stop = Math.max(0, view.byteLength - END_BYTES - MAX_COMMENT);
	for (let at = view.byteLength - END_BYTES; at >= stop; at -= 1) {
		if (view.getUint32(at, true) === END) return at;
	}
	throw new ArchiveError("is not a zip archive: no end-of-central-directory record");
}

/**
 * Every offset in a header comes from the archive itself, so it is checked against the bytes on
 * hand before it is read: a truncated download is an ordinary failure and must refuse as
 * `invalid-archive`, not surface a `DataView` offset `RangeError` with no entry named.
 */
function assertRange(view: DataView, at: number, length: number, what: string): void {
	if (!Number.isInteger(at) || at < 0 || length < 0 || at + length > view.byteLength) {
		throw new ArchiveError(
			`is truncated: ${what} needs bytes ${at}..${at + length}, and the archive holds ${view.byteLength}`,
		);
	}
}

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
	if (method === 0) return raw;
	if (method === 8) return Bun.inflateSync(new Uint8Array(raw), { windowBits: -15 });
	throw new ArchiveError(
		`uses compression method ${method}, and updater reads stored and deflate`,
	);
}

function readCentral(bytes: Uint8Array, view: DataView, at: number, out: ArchiveEntry[]): number {
	assertRange(view, at, 46, "a central directory header");
	if (view.getUint32(at, true) !== CENTRAL) {
		throw new ArchiveError("has a damaged central directory");
	}
	if ((view.getUint16(at + 8, true) & 0x1) !== 0) {
		throw new ArchiveError("is encrypted, and updater reads only an unencrypted archive");
	}
	const method = view.getUint16(at + 10, true);
	const size = view.getUint32(at + 20, true);
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
	const data = dataOf(bytes, view, local, size, method);
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
	let at = offset;
	for (let index = 0; index < count; index += 1) {
		at = readCentral(bytes, view, at, entries);
	}
	for (const entry of entries) assertEntryName(entry.name);
	const root = archiveRoot(entries);
	for (const entry of entries) {
		if (entry.kind === "symlink") assertLinkInside(entry, root);
	}
	return { root, entries };
}
