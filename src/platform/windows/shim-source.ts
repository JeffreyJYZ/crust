/**
 * The Win32 + WebView2 shim, as one compilation unit assembled from parts. It must stay one unit:
 * `20_class.c`'s window procedure resizes the controller that `42_webview.c`'s table holds, and the
 * prelude forward-declares both sides, so the order below is load-bearing rather than layout.
 * No `#include` anywhere — every Win32 and COM entry point is a hand-written prototype, and every
 * one of them is resolved at runtime by `12_win32.c`, which is what lets TinyCC compile and link
 * this with no SDK and no import library.
 */
import prelude from "./shim/10_prelude.c" with { type: "text" };
import win32 from "./shim/12_win32.c" with { type: "text" };
import windowClass from "./shim/20_class.c" with { type: "text" };
import com from "./shim/30_com.c" with { type: "text" };
import environment from "./shim/32_env.c" with { type: "text" };
import slots from "./shim/34_slots.c" with { type: "text" };
import window from "./shim/40_window.c" with { type: "text" };
import webview from "./shim/42_webview.c" with { type: "text" };

/** The parts, in the only order that compiles. */
export const SHIM_PARTS = [
	prelude,
	win32,
	windowClass,
	com,
	environment,
	slots,
	window,
	webview,
] as const;

/**
 * The whole unit. Joined with a newline because every part ends at a line boundary and a missing
 * separator would weld two declarations together.
 */
export const shimSource = SHIM_PARTS.join("\n");

/** Repo-relative paths, in the same order, for a doctor's on-disk and embedded checks. */
export const SHIM_PART_PATHS = [
	"src/platform/windows/shim/10_prelude.c",
	"src/platform/windows/shim/12_win32.c",
	"src/platform/windows/shim/20_class.c",
	"src/platform/windows/shim/30_com.c",
	"src/platform/windows/shim/32_env.c",
	"src/platform/windows/shim/34_slots.c",
	"src/platform/windows/shim/40_window.c",
	"src/platform/windows/shim/42_webview.c",
] as const;

/** The same list as bare file names, for callers that already know the directory. */
export const SHIM_PART_NAMES = SHIM_PART_PATHS.map((path) => path.slice(path.lastIndexOf("/") + 1));
