/**
 * The Windows half of `crust:screen`: `EnumDisplayMonitors` through the shim, which already reports
 * top-left pixels with y down, so nothing is flipped here — the flip lives in the darwin half where
 * AppKit's origin is bottom-left.
 *
 * UNPROVEN ON WINDOWS, like the rest of this layer: the C unit has never been called against a real
 * monitor. What is proven is the shape — ten doubles per display, and a scale of 1 because per-monitor
 * DPI needs `GetDpiForMonitor` from shcore.dll, which the shim does not load.
 */

import type { ScreenAdapter, ScreenBounds, ScreenRecord } from "@/plugins/screen";
import type { FrameRect } from "@/plugins/window-frame";
import { defaultBackend, type WindowsShim } from "./backend.ts";
import { activeWindowsShim } from "./active-shim.ts";

/** One display from ten doubles: frame, work area, scale, then the primary flag. */
function record(index: number, out: Float64Array): ScreenRecord | undefined {
	const [fx, fy, fw, fh, wx, wy, ww, wh, scale, primary] = Array.from(out) as [
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
	if (![fx, fy, fw, fh].every((value) => Number.isFinite(value))) return undefined;
	if (fw <= 0 || fh <= 0) return undefined;
	const bounds: ScreenBounds = { x: fx, y: fy, width: fw, height: fh };
	const workArea: ScreenBounds = {
		x: Number.isFinite(wx) ? wx : fx,
		y: Number.isFinite(wy) ? wy : fy,
		width: Number.isFinite(ww) && ww > 0 ? ww : fw,
		height: Number.isFinite(wh) && wh > 0 ? wh : fh,
	};
	return {
		id: String(index),
		primary: primary === 1,
		scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
		bounds,
		workArea,
	};
}

/**
 * Read every display through the shim. A shim that cannot enumerate answers an empty list rather
 * than guessing, and the plugin reports that honestly: nothing is connected is not the same as
 * nothing being possible.
 *
 * The shim is the platform's own if one is running; otherwise a single fallback compile happens on
 * the first `list()`, never at import. A fresh `cc()` per call would grow the process and duplicate
 * the native state the window path already owns.
 */
/** Compile at most once per process; `cc()` returns a fresh symbol table and loaded library each call. */
export function onceShim(load: () => WindowsShim): () => WindowsShim {
	let cached: WindowsShim | undefined;
	return () => (cached ??= load());
}

const loadOnce = onceShim(() => defaultBackend().load());

/** Prefer the platform's already-compiled shim; only compile our own when no platform started one. */
function defaultScreenShim(): WindowsShim {
	return activeWindowsShim() ?? loadOnce();
}

export function windowsScreenAdapter(native: () => WindowsShim = defaultScreenShim): ScreenAdapter {
	return {
		list() {
			const shim = native();
			const count = Number(shim.shim_screen_count() ?? 0);
			if (count <= 0) return [];
			const screens: ScreenRecord[] = [];
			for (let index = 0; index < count; index++) {
				const out = new Float64Array(10);
				if (Number(shim.shim_screen_info(index, out) ?? 0) !== 1) continue;
				const entry = record(index, out);
				if (entry !== undefined) screens.push(entry);
			}
			return screens;
		},
	};
}

/**
 * Every monitor's work area in Win32's top-left space, the same rect `getPosition` reports.
 * Lazy for the same reason as the adapter: a launch that restores nothing loads nothing.
 */
export function windowsWindowWorkAreas(): FrameRect[] {
	const listed = windowsScreenAdapter().list();
	return Array.isArray(listed) ? listed.map((entry) => entry.workArea) : [];
}
