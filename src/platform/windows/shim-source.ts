/**
 * The Win32 + WebView2 shim, as one compilation unit assembled from parts. It must stay one unit:
 * `20_class.c`'s window procedure resizes the controller that `41_surfaces.c`'s table holds, and the
 * prelude forward-declares both sides, so the order below is load-bearing rather than layout.
 * No `#include` anywhere — every Win32 and COM entry point is a hand-written prototype, and every
 * one of them is resolved at runtime by `12_win32.c`, which is what lets TinyCC compile and link
 * this with no SDK and no import library.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prelude from "./shim/10_prelude.c" with { type: "text" };
import pointerCore from "./shim/11_pointer_core.c" with { type: "text" };
import styleDecls from "./shim/11_win32_style.c" with { type: "text" };
import win32 from "./shim/12_win32.c" with { type: "text" };
import guard from "./shim/14_guard.c" with { type: "text" };
import windowClass from "./shim/20_class.c" with { type: "text" };
import com from "./shim/30_com.c" with { type: "text" };
import environment from "./shim/32_env.c" with { type: "text" };
import slots from "./shim/34_slots.c" with { type: "text" };
import probe from "./shim/36_probe.c" with { type: "text" };
import window from "./shim/40_window.c" with { type: "text" };
import surfaces from "./shim/41_surfaces.c" with { type: "text" };
import webview from "./shim/42_webview.c" with { type: "text" };
import webviewCalls from "./shim/43_webview_calls.c" with { type: "text" };
import minsize from "./shim/44_minsize.c" with { type: "text" };
import styleMembers from "./shim/45_style.c" with { type: "text" };
import cursorMembers from "./shim/49_cursor.c" with { type: "text" };
import material from "./shim/46_material.c" with { type: "text" };
import screen from "./shim/47_screen.c" with { type: "text" };
import clipboard from "./shim/50_clipboard.c" with { type: "text" };
import opener from "./shim/51_opener.c" with { type: "text" };
import osInfo from "./shim/52_osinfo.c" with { type: "text" };
import dialog from "./shim/48_dialog.c" with { type: "text" };
import dialogPaths from "./shim/48_dialog_paths.c" with { type: "text" };
import dialogCalls from "./shim/49_dialog.c" with { type: "text" };

/**
 * LF, always. A Windows checkout can hand back CRLF, and the source-scanning assertions in this
 * layer match on `\n\t` inside multi-line expectations — so without this the same assertion passes
 * on macOS and Linux and fails only on the Windows runner (measured 2026-11-16, `callback.test.ts`).
 */
export const lf = (text: string): string => text.replace(/\r\n/g, "\n");

/**
 * One shim part from disk, normalised to LF — the **test-facing half of the same rule** `SHIM_PARTS`
 * applies. `shimSource` is what `ffi.ts` compiles, so normalising it was right for the product, but a
 * test that scans the C reads the file itself and never goes through it; fixing one half and not the
 * other is exactly how the Windows runner stayed red after the first attempt.
 */
export function readShimPart(name: string): string {
	return lf(readFileSync(join(import.meta.dir, "shim", name), "utf8"));
}

/** The whole unit as a test reads it: the same parts, the same order, the same LF. */
export function readShimSource(): string {
	return SHIM_PART_NAMES.map(readShimPart).join("\n");
}

/** The parts, in the only order that compiles. */
export const SHIM_PARTS = [
	lf(prelude),
	// The clipboard/opener/`os.info` pointer table, which `12_win32.c` binds — it must precede it.
	lf(pointerCore),
	// The style/opacity/placement/pointer table, on the same rule: before `12_win32.c` binds it.
	lf(styleDecls),
	lf(win32),
	lf(guard),
	lf(windowClass),
	lf(com),
	lf(environment),
	lf(slots),
	lf(probe),
	lf(window),
	// The handle table the webview stops being a singleton on, then the two halves of that surface —
	// window-keyed lifecycle before handle-keyed calls, because `42_webview.c` navigates the surface it
	// has just bound.
	lf(surfaces),
	lf(webview),
	lf(webviewCalls),
	lf(minsize),
	lf(styleMembers),
	lf(material),
	lf(screen),
	lf(dialog),
	lf(dialogPaths),
	lf(dialogCalls),
	// The three namespaces a normal app reaches first: `50`–`52`, over the pointer table above.
	// Last, because `52_osinfo.c` calls `shim_utf8` from `50_clipboard.c` and needs no other order.
	lf(clipboard),
	lf(opener),
	lf(osInfo),
	// The pointer: no hwnd, so no place in `40_window.c`'s table — but `20_class.c`'s WM_SETCURSOR
	// re-applies it, and the prelude's forward declaration is what keeps its position free.
	lf(cursorMembers),
] as const;

/**
 * The whole unit. Joined with a newline because every part ends at a line boundary and a missing
 * separator would weld two declarations together.
 */
export const shimSource = SHIM_PARTS.join("\n");

/** Repo-relative paths, in the same order, for a doctor's on-disk and embedded checks. */
export const SHIM_PART_PATHS = [
	"src/platform/windows/shim/10_prelude.c",
	"src/platform/windows/shim/11_pointer_core.c",
	"src/platform/windows/shim/11_win32_style.c",
	"src/platform/windows/shim/12_win32.c",
	"src/platform/windows/shim/14_guard.c",
	"src/platform/windows/shim/20_class.c",
	"src/platform/windows/shim/30_com.c",
	"src/platform/windows/shim/32_env.c",
	"src/platform/windows/shim/34_slots.c",
	"src/platform/windows/shim/36_probe.c",
	"src/platform/windows/shim/40_window.c",
	"src/platform/windows/shim/41_surfaces.c",
	"src/platform/windows/shim/42_webview.c",
	"src/platform/windows/shim/43_webview_calls.c",
	"src/platform/windows/shim/44_minsize.c",
	"src/platform/windows/shim/45_style.c",
	"src/platform/windows/shim/46_material.c",
	"src/platform/windows/shim/47_screen.c",
	"src/platform/windows/shim/48_dialog.c",
	"src/platform/windows/shim/48_dialog_paths.c",
	"src/platform/windows/shim/49_dialog.c",
	"src/platform/windows/shim/50_clipboard.c",
	"src/platform/windows/shim/51_opener.c",
	"src/platform/windows/shim/52_osinfo.c",
	"src/platform/windows/shim/49_cursor.c",
] as const;

/** The same list as bare file names, for callers that already know the directory. */
export const SHIM_PART_NAMES = SHIM_PART_PATHS.map((path) => path.slice(path.lastIndexOf("/") + 1));
