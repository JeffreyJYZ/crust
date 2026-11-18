/**
 * The native half of `crust:opener` on Linux: `g_app_info_launch_default_for_uri`, GIO's association
 * lookup, which is what a double-click performs. A URL goes through as given; a path becomes a
 * `file://` URI through GLib's `g_filename_to_uri`, so the escaping is GLib's rather than a
 * concatenation here — a space, a `#` or a non-ASCII byte in a filename is the normal case.
 *
 * **`revealItem` is refused by name, and that is the honest answer.** No Linux desktop has a standard
 * "select this file in the file manager" call; the D-Bus interfaces differ per file manager, and
 * opening the containing folder is a different verb. The refusal says so instead of quietly opening
 * the folder and letting the app believe a file is highlighted.
 *
 * UNPROVEN ON REAL GTK: written on macOS, where libgtk-3.so.0 does not exist. The tests drive it
 * through a fake symbol table, so the status mapping and the URI path are proved, not GIO.
 */
import { existsSync } from "node:fs";
import type { OpenerAdapter, OpenerOutcome } from "@/plugins/opener";
import { cstring } from "./cstring.ts";
import { type LinuxShim, shim } from "./shim-ffi.ts";

/** The same three values the darwin adapter reports, so the plugin's mapping is unchanged. */
export const OPENER_STATUS = { opened: 0, notFound: 1, refused: 2 } as const;

/** What a Linux desktop genuinely cannot do, in the words a page's author needs. */
export const NO_REVEAL =
	"crust: no Linux desktop has a standard reveal-a-selection call — the file manager's D-Bus interface differs per desktop, so opener.revealItem refuses instead of opening the folder and pretending the item is selected";

// A strong reference for the duration of one send: `bun:ffi` reads the bytes during the call, and a
// local `Uint8Array` may be collected before it returns.
let pinned: Uint8Array | undefined;

/** Build the opener adapter. The shim compiles on the first command, never at import. */
export function linuxOpenerAdapter(native: () => LinuxShim = () => shim().symbols): OpenerAdapter {
	const send = (
		text: string,
		invoke: (symbols: LinuxShim, bytes: Uint8Array) => number,
	): OpenerOutcome => {
		const symbols = native();
		const bytes = cstring(text);
		pinned = bytes;
		// `bytes.length - 1` is the text without its terminator, the same argument shape the Windows
		// half takes, so one adapter contract covers both.
		if (Number(invoke(symbols, bytes)) === 1)
			return { status: OPENER_STATUS.opened, reason: "" };
		const reason = String(symbols.shim_opener_reason_text?.() ?? "");
		return {
			status: OPENER_STATUS.refused,
			reason:
				reason.length > 0
					? reason
					: "g_app_info_launch_default_for_uri refused with no recorded reason",
		};
	};

	return {
		openPath: (path) =>
			existsSync(path)
				? send(path, (symbols, bytes) =>
						Number(symbols.shim_opener_open_path?.(bytes, bytes.length - 1) ?? 0),
					)
				: { status: OPENER_STATUS.notFound, reason: `no path at ${path}` },
		openUrl: (url) =>
			send(url, (symbols, bytes) =>
				Number(symbols.shim_opener_open_url?.(bytes, bytes.length - 1) ?? 0),
			),
		revealItem: (path) =>
			existsSync(path)
				? { status: OPENER_STATUS.refused, reason: NO_REVEAL }
				: { status: OPENER_STATUS.notFound, reason: `no path at ${path}` },
	};
}
