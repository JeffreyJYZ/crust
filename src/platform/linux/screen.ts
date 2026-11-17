/**
 * The Linux half of `crust:screen`: GDK's monitor enumeration through the shim. GTK3 has no
 * `gdk_display_get_monitors`, so the index-based pair is the whole API there, and the shim resolves
 * each entry point with `shim_sym_or_null` — a GTK too old for one answers `screen.list` by name
 * instead of refusing to launch every app.
 *
 * UNPROVEN ON REAL GTK, like the rest of this layer: the C unit has never been called against a
 * display server. GDK's rectangles are already top-left with y down, so nothing is flipped.
 */

import type { ScreenAdapter, ScreenBounds, ScreenRecord } from "@/plugins/screen";
import { type LinuxShim, shim } from "./shim-ffi.ts";

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
 * Read every display through the shim. `shim_screen_ready` separates "this GDK cannot enumerate"
 * from "no display is connected", so a page can tell the two apart — but both answer an empty list
 * here, because the plugin's own refusal names the missing call.
 */
export function linuxScreenAdapter(native: LinuxShim = shim().symbols): ScreenAdapter {
	return {
		list() {
			if (Number(native.shim_screen_ready?.() ?? 0) !== 1) return [];
			const count = Number(native.shim_screen_count() ?? 0);
			if (count <= 0) return [];
			const screens: ScreenRecord[] = [];
			for (let index = 0; index < count; index++) {
				const out = new Float64Array(10);
				if (Number(native.shim_screen_info(index, out) ?? 0) !== 1) continue;
				const entry = record(index, out);
				if (entry !== undefined) screens.push(entry);
			}
			return screens;
		},
	};
}
