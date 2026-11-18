/**
 * The `bun:ffi` edge for the notification + tray unit: one `cc()` call, its own symbol table, and the
 * table of Win32 entry points the C resolves.
 *
 * Kept apart from `ffi.ts` on purpose — see `notify-tray-source.ts` — and declared by hand for the
 * same reason every other shim is: every `cstring` argument is a NUL-terminated byte buffer, never a
 * JavaScript string, and `bun:ffi` throws on one before C runs.
 */
import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notifyTraySource } from "./notify-tray-source.ts";

const I32 = FFIType.i32;
const CS = FFIType.cstring;

/**
 * The unit's exports, as JavaScript sees them. Every one takes ints or NUL-terminated bytes and
 * returns an int or a static string: no struct, no HWND and no HICON crosses this boundary — the
 * `NOTIFYICONDATAW` the shell reads is built on the C stack.
 */
export interface WindowsNotifyTrayShim {
	/** 1 when every Win32 entry point resolved; 0 with the gap named by `shim_notify_missing`. */
	shim_notify_load(): number;
	shim_notify_ready(): number;
	/** The first entry point that did not resolve, or "" — the machine's own report. */
	shim_notify_missing(): string | null;
	/** Why the last tray or balloon call ended as it did, always one line. */
	shim_notify_reason(): string | null;
	/** `GetLastError()` from the last refused call, or 0. */
	shim_notify_last_error(): number;

	/**
	 * One balloon: 0 the shell queued it, 2 an entry point did not resolve, 3 the shell refused,
	 * 4 there is no notification area to attach an icon to.
	 */
	shim_notify_post(title: Uint8Array, body: Uint8Array): number;

	/** Store the menu labels, one per line; 1 stored, 0 an entry point did not resolve. */
	shim_tray_menu(joined: Uint8Array, count: number): number;
	shim_tray_tooltip(text: Uint8Array): number;
	shim_tray_show(): number;
	shim_tray_hide(): number;
	shim_tray_destroy(): number;
	/** The row clicked since the last call, or -1. Cleared as it is read. */
	shim_tray_click(): number;
}

/** One Win32 entry point the C resolves at runtime, and what stops working without it. */
export interface NotifyTrayPreflightEntry {
	module: string;
	symbol: string;
	breaks: string;
}

const user32 = (symbol: string, breaks: string): NotifyTrayPreflightEntry => ({
	module: "user32.dll",
	symbol,
	breaks,
});

/**
 * Every entry point `60_notify_tray.c` binds with `SHIM_BIND`. `notify-tray-source.test.ts` reads
 * that macro out of the C and fails when a bound symbol is missing here, so this table cannot drift
 * into decoration: it is the list a doctor would print, and the assertion keeps it complete.
 *
 * None of these is in the shared `PREFLIGHT`: this unit resolves its own pointers on its first call
 * and names the one that was absent, which is the whole of what the shared table would have said.
 */
export const NOTIFY_TRAY_PREFLIGHT: readonly NotifyTrayPreflightEntry[] = [
	user32("MultiByteToWideChar", "no title, body, tooltip or label reaches Win32 as text"),
	user32("GetLastError", "a refused call reports no number"),
	user32("GetModuleHandleW", "the hidden window class has no instance to register against"),
	user32("RegisterClassExW", "no hidden window class, so no tray callback and no balloon"),
	user32("CreateWindowExW", "no hidden window, so the notification area has nowhere to call"),
	user32("DefWindowProcW", "unhandled messages fault the hidden window's procedure"),
	user32("DestroyWindow", "tray.destroy leaves the hidden window alive"),
	user32("LoadIconW", "the tray has no icon, and a balloon needs one"),
	user32("CreatePopupMenu", "tray.setMenu has no menu to build"),
	user32("AppendMenuW", "a stored label never becomes a row"),
	user32("DestroyMenu", "every popup leaks its menu handle"),
	user32("TrackPopupMenu", "the menu is built and never shown"),
	user32("GetCursorPos", "the menu has no place to open"),
	user32("SetForegroundWindow", "the menu does not dismiss when the human clicks elsewhere"),
	user32("PostMessageW", "the same dismissal bug, by the documented workaround's other half"),
	{
		module: "shell32.dll",
		symbol: "Shell_NotifyIconW",
		breaks: "no tray icon and no balloon — this is the whole mechanism on Windows",
	},
];

/**
 * Materialise the unit and compile it. Content-hashed, so a second launch reuses the same file and
 * TinyCC's per-path cache. `cc()` links nothing: every Win32 entry point is resolved by the C.
 */
export function compileNotifyTray(): WindowsNotifyTrayShim {
	const hash = createHash("sha256").update(notifyTraySource).digest("hex").slice(0, 16);
	const path = join(tmpdir(), `crust-notify-tray-${hash}.c`);
	if (!existsSync(path)) writeFileSync(path, notifyTraySource);
	const library = cc({
		source: path,
		symbols: {
			shim_notify_load: { args: [], returns: I32 },
			shim_notify_ready: { args: [], returns: I32 },
			shim_notify_missing: { args: [], returns: CS },
			shim_notify_reason: { args: [], returns: CS },
			shim_notify_last_error: { args: [], returns: I32 },
			shim_notify_post: { args: [CS, CS], returns: I32 },
			shim_tray_menu: { args: [CS, I32], returns: I32 },
			shim_tray_tooltip: { args: [CS], returns: I32 },
			shim_tray_show: { args: [], returns: I32 },
			shim_tray_hide: { args: [], returns: I32 },
			shim_tray_destroy: { args: [], returns: I32 },
			shim_tray_click: { args: [], returns: I32 },
		},
	}) as unknown as { symbols: WindowsNotifyTrayShim };
	return library.symbols;
}

let once: WindowsNotifyTrayShim | undefined;

/** Compile at most once per process; `cc()` takes 3–20 ms and the unit lives as long as the app. */
export function notifyTrayShim(): WindowsNotifyTrayShim {
	return (once ??= compileNotifyTray());
}
