/**
 * The GTK readbacks the browser proof needs: the allocation and size request of a placed view, and
 * the pointer format the detail line prints. Split from `proof-browser.ts` at the line cap.
 */
import type { LinuxShim, LinuxProofShim } from "../../src/platform/linux/shim-ffi.ts";

/** A pointer, as the log prints it, so two widget addresses can be told apart. */
export function hex(value: bigint): string {
	return `0x${value.toString(16)}`;
}

/** GTK's size request for one view, read back after each placement. */
export function readRequest(
	shim: LinuxShim & LinuxProofShim,
	web: bigint,
): { width: number; height: number } {
	return {
		width: Number(shim.shim_webview_requested?.(web, 0) ?? 0),
		height: Number(shim.shim_webview_requested?.(web, 1) ?? 0),
	};
}

/** GTK's allocation for one view, as the two numbers the proof compares. */
export function readAllocation(
	shim: LinuxShim & LinuxProofShim,
	web: bigint,
): { width: number; height: number } {
	return {
		width: Number(shim.shim_webview_allocated?.(web, 0) ?? 0),
		height: Number(shim.shim_webview_allocated?.(web, 1) ?? 0),
	};
}
