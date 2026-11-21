/**
 * The compiled browser unit: `shim/131_browser.c` (the view and the shared C helpers) joined with
 * `shim/132_browser_ui.c` (the runtime `WKUIDelegate` and its popup report) into one translation
 * unit, compiled by `cc()` with AppKit, Foundation and WebKit linked by name. It is its own unit
 * rather than a part of the shared shim because those delegate statics must not leak into every
 * window's code.
 *
 * A compiled binary has no readable `import.meta.dir`, so the C travels inside the binary as text
 * and is materialised before `cc()` sees it — the device `media-capture-ffi.ts` uses.
 *
 * Nothing here is called at import time: `browserUnit()` compiles on first use, so a non-macOS
 * process that merely loads the plugin never pays for `cc()`.
 */
import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import viewPart from "./shim/131_browser.c" with { type: "text" };
import uiPart from "./shim/132_browser_ui.c" with { type: "text" };

/** The two halves as one translation unit: the delegate uses the view part's `br_has`/`br_copy`. */
export const browserSource = [viewPart, uiPart].join("\n");

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;
const F64 = FFIType.f64;
const V = FFIType.void;

/**
 * `shim_browser_ui_install`'s answers. `installed` is the only one a surface accepts; `already` can
 * never happen to a fresh webview but is kept honest rather than folded into success.
 */
export const BROWSER_UI_STATUS = {
	installed: 0,
	missing: 1,
	noClass: 3,
	already: 4,
	occupied: 5,
} as const;

/** The exports, as `bun:ffi` hands them back. `BrowserNative` is the seam a fake replaces. */
export interface BrowserUnit {
	symbols: {
		shim_browser_view_new: () => number;
		shim_browser_view_set_frame: (
			view: number,
			x: number,
			y: number,
			width: number,
			height: number,
		) => void;
		shim_browser_attach: (parent: number, view: number) => number;
		shim_browser_detach: (view: number) => void;
		shim_browser_view_release: (view: number) => void;
		shim_browser_ui_install: (web: number) => number;
		shim_browser_ui_installed: (web: number) => number;
		shim_browser_ui_uninstall: (web: number) => void;
		shim_browser_set_sink: (sink: number) => void;
		shim_browser_popups: () => number;
		shim_browser_popup_url: (dst: number, cap: number) => number;
		shim_browser_capture_decision: () => number;
	};
}

export type BrowserNative = BrowserUnit["symbols"];

/** Content-hashed, so a second launch reuses the file and TinyCC's cache. */
function sourcePath(): string {
	const hash = createHash("sha256").update(browserSource).digest("hex").slice(0, 16);
	const file = join(tmpdir(), `crust-browser-${hash}.c`);
	if (!existsSync(file)) writeFileSync(file, browserSource);
	return file;
}

function compile(): BrowserUnit {
	return cc({
		source: sourcePath(),
		flags: ["-framework", "AppKit", "-framework", "Foundation", "-framework", "WebKit"],
		symbols: {
			shim_browser_view_new: { args: [], returns: P },
			shim_browser_view_set_frame: { args: [P, F64, F64, F64, F64], returns: V },
			shim_browser_attach: { args: [P, P], returns: I32 },
			shim_browser_detach: { args: [P], returns: V },
			shim_browser_view_release: { args: [P], returns: V },
			shim_browser_ui_install: { args: [P], returns: I32 },
			shim_browser_ui_installed: { args: [P], returns: I32 },
			shim_browser_ui_uninstall: { args: [P], returns: V },
			shim_browser_set_sink: { args: [P], returns: V },
			shim_browser_popups: { args: [], returns: I32 },
			shim_browser_popup_url: { args: [P, I64], returns: I64 },
			shim_browser_capture_decision: { args: [], returns: I32 },
		},
	}) as unknown as BrowserUnit;
}

let unitOnce: BrowserUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms and runs on the first open. */
export function browserUnit(): BrowserUnit {
	if (process.platform !== "darwin") {
		throw new Error(`crust: the browser surface needs WebKit, and this is ${process.platform}`);
	}
	return (unitOnce ??= compile());
}

/** The real native half: the unit's own exports, read as an object. */
export function darwinBrowserNative(): BrowserNative {
	return browserUnit().symbols;
}
