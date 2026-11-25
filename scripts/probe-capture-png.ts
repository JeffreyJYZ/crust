/**
 * The PNG readback the capture probe needs: dimensions, an opaque-pixel count and a colour count,
 * from the bytes `window.capture` handed back. Its own module because the 200-line cap is a gate and
 * the probe is already the longer half.
 *
 * Hand-rolled on purpose. Bun exposes no pixel readback (`Bun.Image` answers dimensions only), and
 * shelling out to `sips` would drop the alpha channel — and "fully transparent" is exactly the
 * distinction between a picture and a blank answer. WebKit writes 8-bit, non-interlaced RGB or RGBA
 * through `NSBitmapImageRep`, which is the whole surface handled here.
 */
import { inflateSync } from "node:zlib";

/** What the answer decodes to; `opaque` and `differing` are what "a real picture" means. */
export interface Measured {
	width: number;
	height: number;
	pixels: number;
	opaque: number;
	colours: number;
	differing: number;
}

function u32(bytes: Uint8Array, at: number): number {
	return (
		((bytes[at] ?? 0) << 24) |
		((bytes[at + 1] ?? 0) << 16) |
		((bytes[at + 2] ?? 0) << 8) |
		(bytes[at + 3] ?? 0)
	);
}

function concat(parts: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const part of parts) total += part.length;
	const out = new Uint8Array(total);
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

function pixel(bytes: Uint8Array, index: number, channels: number): number {
	const at = index * channels;
	return ((bytes[at] ?? 0) << 16) | ((bytes[at + 1] ?? 0) << 8) | (bytes[at + 2] ?? 0);
}

/** Decode the PNG and count what a caller can see; throws with the header when it cannot. */
export function decodePng(png: Uint8Array): Measured {
	const signature = [137, 80, 78, 71, 13, 10, 26, 10];
	if (png.length < 8 || !signature.every((b, i) => png[i] === b)) throw new Error("not a PNG");
	let offset = 8;
	let width = 0;
	let height = 0;
	let depth = 0;
	let colour = 0;
	let interlace = 0;
	const parts: Uint8Array[] = [];
	while (offset + 8 <= png.length) {
		const length = u32(png, offset);
		const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
		const data = png.subarray(offset + 8, offset + 8 + length);
		if (type === "IHDR") {
			width = u32(data, 0);
			height = u32(data, 4);
			depth = data[8] ?? 0;
			colour = data[9] ?? 0;
			interlace = data[12] ?? 0;
		} else if (type === "IDAT") parts.push(data);
		else if (type === "IEND") break;
		offset += 12 + length;
	}
	const channels = colour === 6 ? 4 : colour === 2 ? 3 : 0;
	if (width < 1 || height < 1) throw new Error(`PNG is ${width}x${height}`);
	if (depth !== 8 || channels === 0)
		throw new Error(`PNG is depth ${depth}, colour type ${colour}, interlace ${interlace}`);
	if (interlace !== 0) throw new Error("interlaced PNG");

	// Undo the per-scanline filters; the bytes inflate to one filter tag plus `stride` pixels a row.
	const raw = inflateSync(concat(parts));
	const stride = width * channels;
	const out = new Uint8Array(height * stride);
	let pos = 0;
	for (let y = 0; y < height; y++) {
		const filter = raw[pos++] ?? 0;
		for (let x = 0; x < stride; x++) {
			const cur = raw[pos + x] ?? 0;
			const left = x >= channels ? (out[y * stride + x - channels] ?? 0) : 0;
			const up = y > 0 ? (out[(y - 1) * stride + x] ?? 0) : 0;
			const corner = x >= channels && y > 0 ? (out[(y - 1) * stride + x - channels] ?? 0) : 0;
			let value = cur;
			if (filter === 1) value = (cur + left) & 255;
			else if (filter === 2) value = (cur + up) & 255;
			else if (filter === 3) value = (cur + ((left + up) >> 1)) & 255;
			else if (filter === 4) {
				const p = left + up - corner;
				const pa = Math.abs(p - left);
				const pb = Math.abs(p - up);
				const pc = Math.abs(p - corner);
				value = (cur + (pa <= pb && pa <= pc ? left : pb <= pc ? up : corner)) & 255;
			} else if (filter !== 0) throw new Error(`PNG filter ${filter}`);
			out[y * stride + x] = value;
		}
		pos += stride;
	}

	const seen = new Set<number>();
	let opaque = 0;
	let differing = 0;
	const first = pixel(out, 0, channels);
	for (let i = 0; i < width * height; i++) {
		const value = pixel(out, i, channels);
		const alpha = channels === 4 ? (out[i * 4 + 3] ?? 0) : 255;
		if (alpha > 0) opaque++;
		if (seen.size < 4096) seen.add(value);
		if (value !== first) differing++;
	}
	return { width, height, pixels: width * height, opaque, colours: seen.size, differing };
}
