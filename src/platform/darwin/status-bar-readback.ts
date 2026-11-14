/**
 * Readback: what AppKit *says* about the live item, as primitives. Every field is a number, flag or string the C unit copied into static storage, so nothing here proves a pixel was drawn — a screenshot is that proof and a run reports the two separately. `-1` from C means "this AppKit has no such selector", not the same as `0` (an item AppKit calls hidden), so it maps to `null` rather than `false`.
 */

import type { StatusBarShim } from "./status-bar-symbols";
import type { StatusBarReadback } from "./status-bar-types";

// The frame out-buffer: `tray_button_window_frame` writes four doubles into it.
// Module-level so the memory stays reachable across the FFI call.
const frameBuffer = new Float64Array(4);

/** One pass over every readback symbol; `target` is a live `NSStatusItem *`. */
export function readbackFrom(native: StatusBarShim, target: number): StatusBarReadback {
	const visible = Number(native.symbols.tray_item_visible(target) ?? -1);
	const length = Number(native.symbols.tray_item_length(target) ?? -1);
	const windowNumber = Number(native.symbols.tray_button_window(target) ?? 0);
	const windowVisible = Number(native.symbols.tray_button_window_visible(target) ?? -1);
	const hasFrame =
		Number(native.symbols.tray_button_window_frame(target, frameBuffer) ?? 0) === 1;
	const occlusion = Number(native.symbols.tray_button_window_occlusion(target) ?? -1);
	const activeSpace = Number(native.symbols.tray_button_window_active_space(target) ?? -1);
	return {
		title: String(native.symbols.tray_title_copy(target) ?? ""),
		visible: visible < 0 ? null : visible === 1,
		length: length < 0 ? null : length,
		windowNumber,
		windowVisible: windowVisible < 0 ? null : windowVisible === 1,
		frame: hasFrame
			? {
					x: frameBuffer[0] ?? 0,
					y: frameBuffer[1] ?? 0,
					width: frameBuffer[2] ?? 0,
					height: frameBuffer[3] ?? 0,
				}
			: null,
		occlusion: occlusion < 0 ? null : occlusion,
		onActiveSpace: activeSpace < 0 ? null : activeSpace === 1,
	};
}
