/**
 * Screen geometry, which is what the positioner and the `screen` plugin both need: AppKit's origin
 * is bottom-left with y up, and "visible" excludes the menu bar and the Dock. Its own C unit, like
 * the clipboard's, so the window shim's translation unit is untouched.
 * `list()` answers top-left page pixels, the one coordinate system every caller reads — see
 * `toTopLeft`.
 */

import { cc, FFIType, ptr } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FrameRect } from "@/plugins/window-frame";

// A compiled binary has no readable source tree, so the C travels inside it.
import screenSource from "./shim/97_screen.c" with { type: "text" };

const P = FFIType.ptr;
const I32 = FFIType.i32;

export interface ScreenFrame {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** What `-[NSScreen backingScaleFactor]` reports: 2 on a Retina display, 1 otherwise. */
export interface ScreenRecord {
	/** AppKit's own index; 0 is the primary display. */
	readonly id: string;
	readonly primary: boolean;
	readonly scale: number;
	readonly bounds: ScreenFrame;
	readonly workArea: ScreenFrame;
}

interface ScreenUnit {
	symbols: {
		shim_screen_visible_frame: (out: number) => number;
		shim_screen_count: () => number;
		shim_screen_info: (index: number, out: number) => number;
	};
}

function compile(): ScreenUnit {
	function sourcePath(): string {
		const hash = createHash("sha256").update(screenSource).digest("hex").slice(0, 16);
		const file = join(tmpdir(), `crust-screen-${hash}.c`);
		if (!existsSync(file)) writeFileSync(file, screenSource);
		return file;
	}

	return cc({
		source: sourcePath(),
		flags: ["-framework", "AppKit", "-framework", "Foundation"],
		symbols: {
			shim_screen_visible_frame: { args: [P], returns: I32 },
			shim_screen_count: { args: [], returns: I32 },
			shim_screen_info: { args: [I32, P], returns: I32 },
		},
	}) as unknown as ScreenUnit;
}

let unitOnce: ScreenUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function screenUnit(): ScreenUnit {
	return (unitOnce ??= compile());
}

/** Null when AppKit reports no screen, which is the honest answer headless. */
export function mainScreenFrame(): ScreenFrame | undefined {
	const out = new Float64Array(4);
	const answered = Number(screenUnit().symbols.shim_screen_visible_frame(ptr(out)) ?? 0);
	if (answered !== 1) return undefined;
	const [x, y, width, height] = Array.from(out);
	if (![x, y, width, height].every((value) => Number.isFinite(value))) return undefined;
	return {
		x: x as number,
		y: y as number,
		width: width as number,
		height: height as number,
	};
}

/** Every finite number in `values`, so a partially written buffer never becomes a frame. */
function finite(...values: number[]): boolean {
	return values.every((value) => Number.isFinite(value));
}

/**
 * AppKit's bottom-left origin, flipped into the top-left page pixels a caller reads.
 * `ceiling` is the primary display's frame height: AppKit places every display in one coordinate
 * space whose origin is the primary's bottom-left, so the top-left y is `ceiling - (y + height)`.
 * A display sitting above the primary then gets a negative y, which is where it really is.
 */
export function toTopLeft(frame: ScreenFrame, ceiling: number): ScreenFrame {
	return {
		x: frame.x,
		y: ceiling - (frame.y + frame.height),
		width: frame.width,
		height: frame.height,
	};
}

/** One display from ten doubles: frame, visible frame, scale, then the primary flag. */
function record(index: number, out: Float64Array, ceiling: number): ScreenRecord | undefined {
	const [fx, fy, fw, fh, vx, vy, vw, vh, scale, primary] = Array.from(out) as [
		number,
		number,
		number,
		number,
		number,
		number,
		number,
		number,
		number,
		number,
	];
	if (!finite(fx, fy, fw, fh, vx, vy, vw, vh, scale)) return undefined;
	if (fw <= 0 || fh <= 0) return undefined;
	return {
		id: String(index),
		primary: primary === 1,
		scale: scale > 0 ? scale : 1,
		bounds: toTopLeft({ x: fx, y: fy, width: fw, height: fh }, ceiling),
		workArea: toTopLeft({ x: vx, y: vy, width: vw, height: vh }, ceiling),
	};
}

/**
 * Every display's visible frame in AppKit's own bottom-left space — the space `getPosition` and
 * `setPosition` report and apply a window frame in. No flip here on purpose: `list()` answers
 * top-left page pixels for pages, while this answers what the window frame rule needs, and mixing
 * the two coordinate systems would silently accept a window on a display that is no longer there.
 */
export function windowWorkAreas(): FrameRect[] {
	const unit = screenUnit();
	const count = Number(unit.symbols.shim_screen_count() ?? 0);
	const areas: FrameRect[] = [];
	for (let index = 0; index < count; index++) {
		const out = new Float64Array(10);
		if (Number(unit.symbols.shim_screen_info(index, ptr(out)) ?? 0) !== 1) continue;
		const vx = Number(out[4]);
		const vy = Number(out[5]);
		const vw = Number(out[6]);
		const vh = Number(out[7]);
		if (!finite(vx, vy, vw, vh) || vw <= 0 || vh <= 0) continue;
		areas.push({ x: vx, y: vy, width: vw, height: vh });
	}
	return areas;
}

/**
 * Every display, in AppKit's own order, as top-left page pixels. An empty list is a real answer
 * for a headless process; the caller decides whether that is a failure.
 */
export function listScreens(): ScreenRecord[] {
	const unit = screenUnit();
	const count = Number(unit.symbols.shim_screen_count() ?? 0);
	if (count <= 0) return [];
	const screens: ScreenRecord[] = [];
	// The flip needs the primary's height before any display is converted, so read it first.
	const first = new Float64Array(10);
	if (Number(unit.symbols.shim_screen_info(0, ptr(first)) ?? 0) !== 1) return [];
	const ceiling = Number(first[3] ?? 0);
	if (!Number.isFinite(ceiling) || ceiling <= 0) return [];
	for (let index = 0; index < count; index++) {
		const out = index === 0 ? first : new Float64Array(10);
		if (index !== 0 && Number(unit.symbols.shim_screen_info(index, ptr(out)) ?? 0) !== 1) {
			continue;
		}
		const entry = record(index, out, ceiling);
		if (entry !== undefined) screens.push(entry);
	}
	return screens;
}

/** For a probe: whether the unit compiled and a screen answered. */
export function screenUnitStatus(): { available: boolean; reason: string } {
	try {
		screenUnit();
	} catch (error) {
		return {
			available: false,
			reason: error instanceof Error ? error.message : String(error),
		};
	}
	const frame = mainScreenFrame();
	return frame
		? { available: true, reason: "compiled" }
		: { available: false, reason: "no screen" };
}
