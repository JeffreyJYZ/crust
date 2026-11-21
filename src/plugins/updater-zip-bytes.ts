/**
 * Raw byte access for the updater's zip reader: a `DataView` over an arbitrary slice, the
 * end-of-central-directory scan, and the range check every offset goes through. No entry policy
 * lives here — that is `updater-slip`'s job — so a truncated archive refuses by name instead of
 * surfacing a `DataView` `RangeError`.
 */

import { ArchiveError } from "./updater-slip";

export const LOCAL = 0x04034b50;
export const END = 0x06054b50;
export const END_BYTES = 22;
const MAX_COMMENT = 0xffff;

export function viewOf(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Whether these bytes open like a zip: a local header, or the record of an empty archive. */
export function isZip(bytes: Uint8Array): boolean {
	if (bytes.length < 4) return false;
	const magic = viewOf(bytes).getUint32(0, true);
	return magic === LOCAL || magic === END;
}

/** The end-of-central-directory record sits last, behind a comment of up to 64 KiB. */
export function findEnd(view: DataView): number {
	const stop = Math.max(0, view.byteLength - END_BYTES - MAX_COMMENT);
	for (let at = view.byteLength - END_BYTES; at >= stop; at -= 1) {
		if (view.getUint32(at, true) === END) return at;
	}
	throw new ArchiveError("is not a zip archive: no end-of-central-directory record");
}

/** Every offset from the archive is checked against the bytes on hand before it is read. */
export function assertRange(view: DataView, at: number, length: number, what: string): void {
	if (!Number.isInteger(at) || at < 0 || length < 0 || at + length > view.byteLength) {
		throw new ArchiveError(
			`is truncated: ${what} needs bytes ${at}..${at + length}, and the archive holds ${view.byteLength}`,
		);
	}
}
