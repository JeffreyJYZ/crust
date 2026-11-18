/**
 * The `notification` + `tray` C unit, as one compilation unit assembled from three parts.
 *
 * It is deliberately NOT in `shim-source.ts`. It shares nothing with the window shim — no slot
 * table, no COM object, no HWND of the app's — and its own `cc()` call is what lets it land without
 * touching `ffi.ts`, `backend.ts`, `fake-shim.ts` or the shared `PREFLIGHT` table, all of which two
 * other lanes are editing in the same directories. darwin's notification unit is separate for the
 * same reason, and this is that pattern with a second part for the menu.
 *
 * The parts share statics (`g_hwnd`, `g_added`, `g_click`, `g_labels`), so the order is load-bearing:
 * `60` declares and resolves, `61` builds the icon and the balloon, `62` opens the menu. None carries
 * an `#include`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import shared from "./shim/60_notify_tray.c" with { type: "text" };
import notify from "./shim/61_notify.c" with { type: "text" };
import tray from "./shim/62_tray.c" with { type: "text" };

/** LF, always: a Windows checkout hands back CRLF, and the source assertions match on `\n`. */
export const lf = (text: string): string => text.replace(/\r\n/g, "\n");

/** Repo-relative paths, in the only order that compiles. */
export const NOTIFY_TRAY_PART_PATHS = [
	"src/platform/windows/shim/60_notify_tray.c",
	"src/platform/windows/shim/61_notify.c",
	"src/platform/windows/shim/62_tray.c",
] as const;

/** The same list as bare file names. */
export const NOTIFY_TRAY_PART_NAMES = NOTIFY_TRAY_PART_PATHS.map((path) =>
	path.slice(path.lastIndexOf("/") + 1),
);

/** The parts, in the only order that compiles. */
export const NOTIFY_TRAY_PARTS = [lf(shared), lf(notify), lf(tray)] as const;

/** The whole unit, joined on a line boundary so two declarations are never welded together. */
export const notifyTraySource = NOTIFY_TRAY_PARTS.join("\n");

/** One part from disk, normalised to LF — what a source assertion reads, and what `cc()` compiles. */
export function readNotifyTrayPart(name: string): string {
	return lf(readFileSync(join(import.meta.dir, "shim", name), "utf8"));
}
