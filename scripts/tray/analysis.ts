/**
 * What changed between two captures: luminance stats over a band, and connected
 * regions of changed pixels, reported in points.
 */
import type { Bitmap } from "./bitmap.ts";
import { type Capture, type Screen, screenSize } from "./capture.ts";
import { CHANGE_THRESHOLD, TEXT_THRESHOLD } from "./constants.ts";

export interface Stats {
	readonly mean: number;
	readonly max: number;
	readonly bright: number;
	readonly pixels: number;
}

/** Luminance stats over a band of rows, in capture pixels. */
export function stats(bitmap: Bitmap, rows?: { from: number; to: number }): Stats {
	const from = Math.max(0, rows?.from ?? 0);
	const to = Math.min(bitmap.height, rows?.to ?? bitmap.height);
	let sum = 0;
	let max = 0;
	let bright = 0;
	let pixels = 0;
	for (let y = from; y < to; y++) {
		for (let x = 0; x < bitmap.width; x++) {
			const value = bitmap.lum[y * bitmap.width + x] ?? 0;
			sum += value;
			if (value > max) max = value;
			if (value >= TEXT_THRESHOLD) bright++;
			pixels++;
		}
	}
	return { mean: pixels === 0 ? 0 : sum / pixels, max, bright, pixels };
}

export interface Cluster {
	/** Bounding box in capture pixels. */
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
	readonly pixels: number;
	readonly brightAfter: number;
	readonly meanAfter: number;
	readonly meanBefore: number;
}

/**
 * Connected regions where the two captures differ, found by flood fill over the
 * changed mask. A status item is a wide horizontal run; a clock tick is narrow,
 * so the width ordering is what tells them apart.
 */
export function clusters(before: Bitmap, after: Bitmap, limit = 6): Cluster[] {
	if (before.width !== after.width || before.height !== after.height) {
		throw new Error(
			`captures differ in size: ${before.width}x${before.height} against ` +
				`${after.width}x${after.height}`,
		);
	}
	const width = after.width;
	const height = after.height;
	const count = width * height;
	const changed = new Uint8Array(count);
	let changedCount = 0;
	for (let index = 0; index < count; index++) {
		const a = before.lum[index] ?? 0;
		const b = after.lum[index] ?? 0;
		if (Math.abs(a - b) > CHANGE_THRESHOLD) {
			changed[index] = 1;
			changedCount++;
		}
	}
	if (changedCount === 0) return [];

	const seen = new Uint8Array(count);
	const stack = new Int32Array(count);
	const found: Cluster[] = [];

	for (let start = 0; start < count; start++) {
		if (changed[start] === 0 || seen[start] === 1) continue;
		let top = 0;
		stack[top++] = start;
		seen[start] = 1;
		let minX = width;
		let maxX = -1;
		let minY = height;
		let maxY = -1;
		let pixels = 0;
		let brightAfter = 0;
		let sumAfter = 0;
		let sumBefore = 0;

		while (top > 0) {
			const index = stack[--top] ?? 0;
			const x = index % width;
			const y = (index - x) / width;
			pixels++;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
			const afterValue = after.lum[index] ?? 0;
			sumAfter += afterValue;
			sumBefore += before.lum[index] ?? 0;
			if (afterValue >= TEXT_THRESHOLD) brightAfter++;

			const neighbours = [
				x > 0 ? index - 1 : -1,
				x + 1 < width ? index + 1 : -1,
				y > 0 ? index - width : -1,
				y + 1 < height ? index + width : -1,
			];
			for (const next of neighbours) {
				if (next < 0 || changed[next] === 0 || seen[next] === 1) continue;
				seen[next] = 1;
				stack[top++] = next;
			}
		}

		found.push({
			x: minX,
			y: minY,
			w: maxX - minX + 1,
			h: maxY - minY + 1,
			pixels,
			brightAfter,
			meanAfter: sumAfter / pixels,
			meanBefore: sumBefore / pixels,
		});
	}

	found.sort((a, b) => b.w - a.w || b.pixels - a.pixels);
	return found.slice(0, limit);
}

/** A cluster in points, which is the unit a human reads a menu bar in. */
export function inPoints(cluster: Cluster, scale: number): Record<string, number> {
	const round = (value: number): number => Math.round(value * 10) / 10;
	return {
		x: round(cluster.x / scale),
		y: round(cluster.y / scale),
		width: round(cluster.w / scale),
		height: round(cluster.h / scale),
		pixels: cluster.pixels,
		brightAfter: cluster.brightAfter,
		meanAfter: round(cluster.meanAfter),
		meanBefore: round(cluster.meanBefore),
	};
}

/** One capture's measured facts, or the reason its decode failed. */
export function measured(
	shot: Capture,
	scale: number,
	rows?: { from: number; to: number },
): unknown {
	if (shot.bitmap === null) return { error: shot.error };
	const band = stats(shot.bitmap, rows);
	return {
		path: shot.bitmap.path,
		bytes: shot.bitmap.bytes,
		width: shot.bitmap.width,
		height: shot.bitmap.height,
		meanLuminance: Math.round(band.mean * 10) / 10,
		maxLuminance: Math.round(band.max * 10) / 10,
		brightPixels: band.bright,
		scale,
	};
}

/** The display the captures are clamped to, exposed for the entry's report. */
export function screenRect(): Screen {
	return screenSize();
}
