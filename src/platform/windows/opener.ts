/**
 * The native half of `crust:opener` on Windows: `ShellExecuteW("open", …)` — the shell's own
 * association lookup, which is exactly what a double-click performs. A URL takes the same call, so
 * `openUrl` and `openPath` differ only in what they hand over; `revealItem` is the shell's
 * `/select,` verb, which is what "show me this file" means on Windows.
 *
 * **The return value is not an error code.** `ShellExecuteW` answers an HINSTANCE, and anything at or
 * below 32 is a `SE_ERR_*` value (2 file not found, 5 access denied, 31 no association). The C half
 * makes that comparison and records the step and number as a reason, so a refusal here is a sentence
 * and never a hex HRESULT that points at the wrong thing.
 *
 * A path that is not on disk is refused before any send, the same rule darwin follows: the shell
 * would open a search rather than say the file is gone.
 *
 * UNPROVEN ON WINDOWS: written on macOS. The tests drive it through the fake shim, so the shape and
 * the status mapping are proved, not shell32.
 */
import { existsSync } from "node:fs";
import type { OpenerAdapter, OpenerOutcome } from "@/plugins/opener";
import { NO_WINDOWS_SHIM, activeWindowsShim } from "./active-shim.ts";
import type { WindowsShim } from "./backend.ts";
import { cstring } from "./cstring.ts";

/** The same three values the darwin adapter reports, so the plugin's mapping is unchanged. */
export const OPENER_STATUS = { opened: 0, notFound: 1, refused: 2 } as const;

// A strong reference for the duration of one send: `bun:ffi` reads the bytes during the call, and a
// local `Uint8Array` may be collected before it returns.
let pinned: Uint8Array | undefined;

/** The reason the C half recorded, or a sentence naming the missing one. */
function reasonOf(shim: WindowsShim): string {
	const reason = String(shim.shim_opener_reason_text() ?? "");
	return reason.length > 0 ? reason : "ShellExecuteW refused with no recorded reason";
}

/** Build the opener adapter. The shim is asked per call, never held at construction. */
export function windowsOpenerAdapter(
	native: () => WindowsShim | undefined = activeWindowsShim,
): OpenerAdapter {
	const send = (
		text: string,
		invoke: (shim: WindowsShim, bytes: Uint8Array) => number,
	): OpenerOutcome => {
		const shim = native();
		if (shim === undefined) return { status: OPENER_STATUS.refused, reason: NO_WINDOWS_SHIM };
		const bytes = cstring(text);
		pinned = bytes;
		// `bytes.length - 1` is the text without its terminator: the C half converts that many bytes.
		if (Number(invoke(shim, bytes)) === 1) return { status: OPENER_STATUS.opened, reason: "" };
		return { status: OPENER_STATUS.refused, reason: reasonOf(shim) };
	};

	return {
		openPath: (path) =>
			existsSync(path)
				? send(path, (shim, bytes) => shim.shim_opener_open_path(bytes, bytes.length - 1))
				: { status: OPENER_STATUS.notFound, reason: `no path at ${path}` },
		openUrl: (url) =>
			send(url, (shim, bytes) => shim.shim_opener_open_url(bytes, bytes.length - 1)),
		revealItem: (path) =>
			existsSync(path)
				? send(path, (shim, bytes) => shim.shim_opener_reveal(bytes, bytes.length - 1))
				: { status: OPENER_STATUS.notFound, reason: `no path at ${path}` },
	};
}
