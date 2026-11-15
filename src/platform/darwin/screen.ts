/**
 * The main screen's visible frame, which is what the positioner needs: AppKit's
 * origin is bottom-left with y up, and "visible" excludes the menu bar and the
 * Dock. Its own C unit, like the clipboard's, so the window shim's translation
 * unit is untouched.
 */

import { cc, FFIType, ptr } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

interface ScreenUnit {
	symbols: {
		shim_screen_visible_frame: (out: number) => number;
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
		symbols: { shim_screen_visible_frame: { args: [P], returns: I32 } },
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
	return { x: x as number, y: y as number, width: width as number, height: height as number };
}

/** For a probe: whether the unit compiled and a screen answered. */
export function screenUnitStatus(): { available: boolean; reason: string } {
	try {
		screenUnit();
	} catch (error) {
		return { available: false, reason: error instanceof Error ? error.message : String(error) };
	}
	const frame = mainScreenFrame();
	return frame ? { available: true, reason: "compiled" } : { available: false, reason: "no screen" };
}
