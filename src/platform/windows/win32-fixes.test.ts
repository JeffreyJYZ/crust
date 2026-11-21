/**
 * Source-level guards for Win32 paths that cannot run on this machine. The `SetWindowPos` mask is
 * measured, not just scanned: a style write with the wrong bits moves and resizes the window to the
 * zeroes the caller passes, and nothing in the adapter can see it happen.
 */
import { describe, expect, test } from "bun:test";
import { cc, FFIType } from "bun:ffi";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readShimPart } from "./shim-source.ts";

const STYLE = readShimPart("11_win32_style.c");

/** The SWP_* defines, sliced out of the shipped part and compiled as they are. */
const FLAGS = STYLE.split("\n")
	.filter((line) => line.startsWith("#define SHIM_SWP_"))
	.join("\n");

const source = [
	FLAGS,
	"unsigned int frame_flags(void) { return SHIM_SWP_FRAME_ONLY; }",
	"unsigned int topmost_flags(void) { return SHIM_SWP_TOPMOST; }",
].join("\n");
const path = join(tmpdir(), "crust-win32-flags.c");
writeFileSync(path, source);
const { symbols } = cc({
	source: path,
	symbols: {
		frame_flags: { args: [], returns: FFIType.u32 },
		topmost_flags: { args: [], returns: FFIType.u32 },
	},
});

/** The body of a C function, up to its closing brace at column zero. */
function body(part: string, signature: string): string {
	const start = part.indexOf(signature);
	expect(start).toBeGreaterThan(-1);
	return part.slice(start, part.indexOf("\n}", start));
}

describe("the SetWindowPos flag a style write uses", () => {
	test("FRAME_ONLY is 0x37: NOSIZE, NOMOVE, NOZORDER, NOACTIVATE, FRAMECHANGED", () => {
		// 0x34 dropped NOSIZE and NOMOVE, so the zeroes passed for x/y/w/h became a new 0,0 0x0
		// frame. The measured value is the guard; the named bits are why it is that value.
		expect(Number(symbols.frame_flags())).toBe(0x37);
	});

	test("every no-change bit is named so the arithmetic cannot drift again", () => {
		for (const bit of [
			"SHIM_SWP_NOSIZE 0x0001u",
			"SHIM_SWP_NOMOVE 0x0002u",
			"SHIM_SWP_NOZORDER 0x0004u",
			"SHIM_SWP_NOACTIVATE 0x0010u",
			"SHIM_SWP_FRAMECHANGED 0x0020u",
		])
			expect(STYLE).toContain(`#define ${bit}`);
		expect(STYLE).not.toContain("#define SHIM_SWP_FRAME_ONLY 0x0034u");
	});

	test("a topmost write still changes the z-order", () => {
		expect(Number(symbols.topmost_flags())).toBe(0x13);
	});
});

describe("the committed-navigation gate in the shim", () => {
	test("NavigationStarting asks the sink and cancels a refused commit", () => {
		const events = readShimPart("58_browser_events.c");
		expect(events).toContain("g_popup_sink)(0, g_popups, web)");
		expect(events).toContain("g_popup_sink)(1, g_navs, sender)");
		expect(events).toContain("handler->loading == 1 && !shim_nav_commit(args, sender)");
		expect(events).toContain("SHIM_SLOT_NAV_ARGS_PUT_CANCEL");
		expect(events).toContain("int shim_browser_nav_url(char *dst, int cap)");
		const ffi = readFileSync(join(import.meta.dir, "ffi-webview.ts"), "utf8");
		expect(ffi).toContain("shim_browser_nav_url: { args: [P, I32], returns: I32 }");
	});

	test("the nav-argument vtable slots are derived from the published order", () => {
		const slots = readShimPart("11_browser_slots.c");
		expect(slots).toContain("#define SHIM_SLOT_NAV_ARGS_GET_URI 3");
		expect(slots).toContain("#define SHIM_SLOT_NAV_ARGS_PUT_CANCEL 8");
	});
});

describe("native guards on paths that cannot run here", () => {
	test("a failed browser create returns -1, never the app's handle 0", () => {
		const create = body(readShimPart("57_browser.c"), "int shim_browser_surface_new(");
		expect(create).toContain("if (handle <= 0) return -1;");
		expect(create).not.toContain("return 0;");
	});

	test("dialog reset clears the whole name buffer, not just its first unit", () => {
		const reset = body(readShimPart("48_dialog.c"), "void shim_dialog_reset(");
		expect(reset).toContain("for (i = 0; i < SHIM_DIALOG_NAME_MAX; i++) g_dlg_names[i] = 0;");
	});

	test("a title-bar close frees its minimum-size slot like destroy does", () => {
		const proc = readShimPart("20_class.c");
		const start = proc.indexOf("if (msg == SHIM_WM_DESTROY)");
		expect(start).toBeGreaterThan(-1);
		const arm = proc.slice(start, proc.indexOf("\n\t}", start));
		expect(arm).toContain("shim_webview_close(hwnd)");
		expect(arm).toContain("shim_window_set_min(hwnd, 0, 0)");
	});
});
