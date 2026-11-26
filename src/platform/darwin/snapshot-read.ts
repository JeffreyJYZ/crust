/** The second pass over a finished snapshot: length first, then a buffer of exactly that size. */
import { ptr } from "bun:ffi";
import type { SnapshotNative } from "./snapshot-unit.ts";

/** What the C unit left behind: raw PNG bytes and the numbers measured from them. */
export interface SnapshotBytes {
	width: number;
	height: number;
	scale: number;
	/** One distinct colour and zero differing pixels, measured from the finished bitmap in C. */
	flat: boolean;
	png: Uint8Array;
}

/** One pass either truncates or copies a race, so the read is sized from C's own length first. */
export function readShot(symbols: SnapshotNative): SnapshotBytes {
	const length = Number(symbols.crust_shot_length() ?? -1);
	if (!Number.isFinite(length) || length <= 0) {
		throw new Error("crust: window.capture produced no PNG bytes");
	}
	const buffer = new Uint8Array(length);
	const copied = Number(symbols.crust_shot_read(ptr(buffer), buffer.length) ?? -1);
	if (copied !== length) {
		throw new Error(`crust: window.capture read ${copied} of ${length} PNG bytes`);
	}
	return {
		width: Number(symbols.crust_shot_width() ?? 0),
		height: Number(symbols.crust_shot_height() ?? 0),
		scale: Number(symbols.crust_shot_scale() ?? 0),
		flat: Number(symbols.crust_shot_flat() ?? 0) === 1,
		png: buffer,
	};
}
