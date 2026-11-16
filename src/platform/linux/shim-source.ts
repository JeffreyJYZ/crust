/**
 * The Linux shim, as one compilation unit assembled from parts. It must stay one unit: the parts share the error buffer and the window slot table, and none carries an `#include` — every GTK and WebKit entry point is a hand-written prototype resolved through `dlopen` — so the order below is load-bearing, not layout.
 * Parts are numbered because the unit reads top to bottom: the prelude opens both libraries and forward-declares the three resolve functions the later parts define.
 */
import prelude from "./shim/10_prelude.c" with { type: "text" };
import webview from "./shim/30_webview.c" with { type: "text" };
import window from "./shim/40_window.c" with { type: "text" };
import pump from "./shim/50_pump.c" with { type: "text" };

/** The parts, in the only order that compiles. */
export const SHIM_PARTS = [prelude, webview, window, pump] as const;

/**
 * The whole unit. Joined with a newline because every part ends at a line boundary
 * and a missing separator would weld two declarations together.
 */
export const shimSource = SHIM_PARTS.join("\n");

/** Repo-relative paths, in the same order, for a doctor's on-disk and embedded checks. */
export const SHIM_PART_PATHS = [
	"src/platform/linux/shim/10_prelude.c",
	"src/platform/linux/shim/30_webview.c",
	"src/platform/linux/shim/40_window.c",
	"src/platform/linux/shim/50_pump.c",
] as const;

/** The same list as bare file names, for callers that already know the directory. */
export const SHIM_PART_NAMES = SHIM_PART_PATHS.map((path) => path.slice(path.lastIndexOf("/") + 1));
