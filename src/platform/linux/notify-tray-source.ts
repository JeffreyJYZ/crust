/**
 * The Linux `notification` + `tray` C unit, as one compilation unit assembled from two parts.
 *
 * Deliberately NOT in `shim-source.ts`: it shares nothing with the window shim's slot table, and its
 * own `cc()` call is what lets it land without touching `shim-ffi.ts` or the shared `PREFLIGHT`
 * table. darwin's notification unit is separate for the same reason.
 *
 * The parts share statics (`g_missing`, `g_reason`, `shim_copy`, `shim_sym`), so the order is
 * load-bearing: `80` declares them and resolves libnotify, `81` resolves GTK and uses them.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import notify from "./shim/80_notify.c" with { type: "text" };
import tray from "./shim/81_tray.c" with { type: "text" };

/** Repo-relative paths, in the only order that compiles. */
export const NOTIFY_TRAY_PART_PATHS = [
	"src/platform/linux/shim/80_notify.c",
	"src/platform/linux/shim/81_tray.c",
] as const;

/** The same list as bare file names. */
export const NOTIFY_TRAY_PART_NAMES = NOTIFY_TRAY_PART_PATHS.map((path) =>
	path.slice(path.lastIndexOf("/") + 1),
);

/** The parts, in the only order that compiles. */
export const NOTIFY_TRAY_PARTS = [notify, tray] as const;

/** The whole unit, joined on a line boundary so two declarations are never welded together. */
export const notifyTraySource = NOTIFY_TRAY_PARTS.join("\n");

/** One part from disk — what a source assertion reads, and the same bytes `cc()` compiles. */
export function readNotifyTrayPart(name: string): string {
	return readFileSync(join(import.meta.dir, "shim", name), "utf8");
}
