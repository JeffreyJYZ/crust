/**
 * Evidence probe: is the crust tray status item actually *drawn* on the menu
 * bar, or does it only exist as an AppKit object that reports success?
 *
 * The README says nobody has seen it — an earlier run landed on a fullscreen
 * space where the menu bar is hidden. So this run answers one question with
 * pixels instead of a return value:
 *
 *   1. bring AppKit up the way `startApp` does (NSApplicationLoad →
 *      sharedApplication → activation policy) and pump it on a 16 ms timer, so
 *      the item is created inside a real, drawing application;
 *   2. capture the menu-bar strip *before* the item exists, then again with a
 *      distinctive title up, then hidden, then re-shown, then destroyed;
 *   3. read the item back from AppKit and the WindowServer — the applied title,
 *      `isVisible`, `length`, and the button window's frame, `isVisible`,
 *      `isOnActiveSpace` and `occlusionState` — and capture that window's own
 *      rectangle as well, so its pixels are compared in place;
 *   4. decode each capture (BMP, so no image library is needed) and report the
 *      pixels that changed, as a bounding box in points plus how bright the
 *      "after" pixels are inside it.
 *
 * The split matters. The readback is AppKit's *claim* about layout; the
 * screenshot is what the screen shows. When they disagree — a fullscreen space
 * keeps `isVisible = true` while the bar is off-screen — that disagreement is
 * the result, and it is reported as disagreement, not resolved by guessing.
 *
 * What it cannot do, by design: click, type, move the pointer or otherwise
 * drive the UI. A screenshot is a read. Nothing is left running: the item is
 * destroyed, the pump is stopped and the process exits.
 *
 *   bun run scripts/probe-tray.ts
 *
 * Exit status is 0 whenever the measurements themselves ran, including when the
 * item turned out to be invisible; the report says which answer it found.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlatform } from "@/platform/darwin/index.ts";
import { createStatusBar, type StatusBarReadback } from "@/platform/darwin/status-bar.ts";

/** Long and wide enough to be unmistakable at 2x, short enough for one buffer. */
const TITLE = "CRUSTTRAY";

/** The menu-bar strip, in points: full width, the height of a notched bar plus slack. */
const STRIP_HEIGHT = 60;

/** A pixel counts as changed when its luminance moves by more than this. */
const CHANGE_THRESHOLD = 24;

/** A pixel counts as "text" when it is this bright or brighter. */
const TEXT_THRESHOLD = 140;

/** NSWindowOcclusionStateVisible, bit 2 — the WindowServer's own "on screen". */
const OCCLUSION_VISIBLE = 2;

const DIR = join(tmpdir(), "crust-tray-probe");

// --- bitmap ----------------------------------------------------------------

interface Bitmap {
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
function decodeBmp(path: string): Bitmap {
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

// --- capture ---------------------------------------------------------------

interface Capture {
	readonly name: string;
	readonly bitmap: Bitmap | null;
	/** Empty when the capture succeeded; the exact stderr otherwise. */
	readonly error: string;
}

let screen = { x: 0, y: 0, w: 0, h: 0 };

function capture(name: string, region: string | null, extra: string[] = []): Capture {
	const path = join(DIR, `${name}.bmp`);
	const args = ["screencapture", "-x", "-t", "bmp"];
	if (region !== null) args.push("-R", region);
	const proc = Bun.spawnSync({ cmd: [...args, ...extra, path], stdout: "pipe", stderr: "pipe" });
	const stderr = proc.stderr.toString().trim();
	if (proc.exitCode !== 0) {
		return { name, bitmap: null, error: `exit ${proc.exitCode}: ${stderr || "(no stderr)"}` };
	}
	try {
		return { name, bitmap: decodeBmp(path), error: "" };
	} catch (error) {
		return {
			name,
			bitmap: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** The display rectangle in points, which is what `-R` takes. */
function desktopBounds(): { x: number; y: number; w: number; h: number } {
	const proc = Bun.spawnSync({
		cmd: ["osascript", "-e", 'tell application "Finder" to get bounds of window of desktop'],
		stdout: "pipe",
		stderr: "pipe",
	});
	const text = proc.stdout.toString().trim();
	const parts = text.split(",").map((piece) => Number(piece.trim()));
	const [right, bottom] = [parts[2] ?? Number.NaN, parts[3] ?? Number.NaN];
	if (proc.exitCode !== 0 || parts.length !== 4 || !Number.isFinite(right)) {
		throw new Error(`desktop bounds unreadable: ${text || proc.stderr.toString().trim()}`);
	}
	return { x: 0, y: 0, w: right, h: Number.isFinite(bottom) ? bottom : 0 };
}

/** `-R` string for a rect in top-left screen points, clamped to the display. */
function regionOf(rect: { x: number; y: number; width: number; height: number }): string | null {
	const x = Math.round(Math.max(0, Math.min(screen.w - 1, rect.x)));
	const y = Math.round(Math.max(0, Math.min(screen.h - 1, rect.y)));
	const w = Math.round(Math.min(rect.width, screen.w - x));
	const h = Math.round(Math.min(rect.height, screen.h - y));
	if (!(w > 0) || !(h > 0)) return null;
	return `${x},${y},${w},${h}`;
}

// --- pixel analysis --------------------------------------------------------

interface Stats {
	readonly mean: number;
	readonly max: number;
	readonly bright: number;
	readonly pixels: number;
}

/** Luminance stats over a band of rows, in capture pixels. */
function stats(bitmap: Bitmap, rows?: { from: number; to: number }): Stats {
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

interface Cluster {
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
function clusters(before: Bitmap, after: Bitmap, limit = 6): Cluster[] {
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
function inPoints(cluster: Cluster, scale: number): Record<string, number> {
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

function measured(shot: Capture, scale: number, rows?: { from: number; to: number }): unknown {
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

// --- run -------------------------------------------------------------------

async function main(): Promise<void> {
	mkdirSync(DIR, { recursive: true });

	screen = desktopBounds();
	const strip = `${screen.x},${screen.y},${screen.w},${STRIP_HEIGHT}`;

	const platform = createPlatform({ appName: "crust tray probe" });
	await platform.start();
	platform.pump(16);
	await Bun.sleep(300);

	const baseline = capture("00-baseline", strip);
	if (baseline.bitmap === null) {
		platform.stopPump();
		report({
			title: TITLE,
			region: strip,
			captureAvailable: false,
			captureError: baseline.error,
			conclusion: "screen capture is unavailable to this process; pixels prove nothing",
		});
		return;
	}

	const scale = baseline.bitmap.width / STRIP_HEIGHT > 0 ? baseline.bitmap.width / screen.w : 0;
	const barHeight = baseline.bitmap.height / scale;
	const barBand = { from: 0, to: Math.round(barHeight * 0.62) };

	const bar = createStatusBar();
	bar.setTitle(TITLE);
	bar.show();
	await Bun.sleep(700);

	const readback: StatusBarReadback = bar.readback();
	const shown = capture("01-shown", strip);
	const itemRegion = readback.frame === null ? null : regionOf(frameToTopLeft(readback.frame));
	const itemShown = itemRegion === null ? null : capture("02-item-shown", itemRegion);

	const windowShot =
		readback.windowNumber > 0
			? capture("03-button-window", null, ["-l", String(readback.windowNumber)])
			: { name: "03-button-window", bitmap: null, error: "no button window number" };

	bar.hide();
	await Bun.sleep(500);
	const hidden = capture("04-hidden", strip);

	bar.show();
	await Bun.sleep(500);
	const reshown = capture("05-reshown", strip);

	bar.destroy();
	await Bun.sleep(600);
	const gone = capture("06-gone", strip);
	const itemGone = itemRegion === null ? null : capture("07-item-gone", itemRegion);
	platform.stopPump();

	const differences: Record<string, unknown> = {};
	if (shown.bitmap) {
		differences["baseline to shown"] = {
			clusters: clusters(baseline.bitmap, shown.bitmap).map((one) => inPoints(one, scale)),
		};
	}
	if (hidden.bitmap && shown.bitmap) {
		differences["shown to hidden"] = {
			clusters: clusters(shown.bitmap, hidden.bitmap).map((one) => inPoints(one, scale)),
		};
	}
	if (reshown.bitmap) {
		differences["baseline to re-shown"] = {
			clusters: clusters(baseline.bitmap, reshown.bitmap).map((one) => inPoints(one, scale)),
		};
	}
	if (gone.bitmap) {
		differences["baseline to destroyed"] = {
			clusters: clusters(baseline.bitmap, gone.bitmap).map((one) => inPoints(one, scale)),
		};
	}
	if (itemShown?.bitmap && itemGone?.bitmap) {
		const inside = clusters(itemShown.bitmap, itemGone.bitmap, 20);
		differences["item-rect shown to destroyed"] = {
			region: itemRegion,
			changedPixels: inside.reduce((sum, one) => sum + one.pixels, 0),
			clusters: inside.map((one) => inPoints(one, scale)),
		};
	}

	report({
		title: TITLE,
		region: strip,
		screen,
		scale,
		captureAvailable: true,
		// A drawn menu bar has text in its top band; a fullscreen window does not.
		menuBarBandBrightPixels: stats(baseline.bitmap, barBand).bright,
		readback,
		frameTopLeft: readback.frame === null ? null : frameToTopLeft(readback.frame),
		itemRegion,
		captures: {
			baseline: measured(baseline, scale),
			shown: measured(shown, scale),
			hidden: measured(hidden, scale),
			"item-shown": itemShown === null ? "no frame to crop" : measured(itemShown, scale),
			"item-gone": itemGone === null ? "no frame to crop" : measured(itemGone, scale),
			"button-window": measured(windowShot, scale),
		},
		differences,
		occlusionVisible:
			readback.occlusion === null ? null : readback.occlusion === OCCLUSION_VISIBLE,
	});
}

/** AppKit frames have a bottom-left origin; `-R` wants a top-left one. */
function frameToTopLeft(frame: { x: number; y: number; width: number; height: number }): {
	x: number;
	y: number;
	width: number;
	height: number;
} {
	return {
		x: frame.x,
		y: screen.h - (frame.y + frame.height),
		width: frame.width,
		height: frame.height,
	};
}

function report(payload: Record<string, unknown>): void {
	const text = JSON.stringify(payload, null, "\t");
	writeFileSync(join(DIR, "report.json"), `${text}\n`);
	process.stdout.write(`${text}\n`);
}

await main();
