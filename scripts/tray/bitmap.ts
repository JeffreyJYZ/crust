/** Decoding what `screencapture` wrote: 32-bit BMP, masks read from the file. */
import { readFileSync } from "node:fs";

export interface Bitmap {
	readonly path: string;
	readonly bytes: number;
	readonly width: number;
	readonly height: number;
	readonly lum: Float32Array;
}

/**
 * Decode the BMP `screencapture -t bmp` writes: 32 bpp, BI_BITFIELDS, masks
 * inside a V4/V5 header, and a negative height meaning top-down. Masks are read
 * from the file rather than assumed, so a channel reorder is a decode error and
 * not a silent colour shift.
 */
export function decodeBmp(path: string): Bitmap {
	const buffer = readFileSync(path);
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	if (view.getUint16(0, true) !== 0x4d42) throw new Error(`${path}: not a BMP`);

	const headerSize = view.getUint32(14, true);
	const width = view.getInt32(18, true);
	const rawHeight = view.getInt32(22, true);
	const bpp = view.getUint16(28, true);
	const compression = view.getUint32(30, true);
	const pixelOffset = view.getUint32(10, true);

	if (bpp !== 32) throw new Error(`${path}: expected 32 bpp, got ${bpp}`);
	if (headerSize < 52) throw new Error(`${path}: no channel masks in the header`);
	if (compression !== 3 && compression !== 6) {
		throw new Error(`${path}: expected BI_BITFIELDS, got compression ${compression}`);
	}

	const redMask = view.getUint32(14 + 40, true) >>> 0;
	const greenMask = view.getUint32(14 + 44, true) >>> 0;
	const blueMask = view.getUint32(14 + 48, true) >>> 0;

	const shiftOf = (mask: number): number => {
		if (mask === 0) return 0;
		let shift = 0;
		while (((mask >>> shift) & 1) === 0) shift++;
		return shift;
	};
	const maxOf = (mask: number): number => (mask === 0 ? 1 : mask >>> shiftOf(mask));
	const rShift = shiftOf(redMask);
	const gShift = shiftOf(greenMask);
	const bShift = shiftOf(blueMask);
	const rMax = maxOf(redMask);
	const gMax = maxOf(greenMask);
	const bMax = maxOf(blueMask);

	const height = Math.abs(rawHeight);
	const topDown = rawHeight < 0;
	const stride = width * 4;
	const lum = new Float32Array(width * height);

	for (let y = 0; y < height; y++) {
		const row = topDown ? y : height - 1 - y;
		const base = pixelOffset + row * stride;
		for (let x = 0; x < width; x++) {
			const pixel = view.getUint32(base + x * 4, true) >>> 0;
			const r = ((pixel & redMask) >>> rShift) * (255 / rMax);
			const g = ((pixel & greenMask) >>> gShift) * (255 / gMax);
			const b = ((pixel & blueMask) >>> bShift) * (255 / bMax);
			lum[y * width + x] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		}
	}

	return { path, bytes: buffer.byteLength, width, height, lum };
}
