/**
 * The `bun:ffi` declarations for the plugin surfaces that are not the window/WebView2 one: `screen`,
 * `clipboard`, `opener` and `os.info`, over `47_screen.c`, `50_clipboard.c`, `51_opener.c` and
 * `52_osinfo.c`.
 *
 * Split out of `ffi.ts` when that file reached the line cap, and because the table reads as two
 * responsibilities: the window surface, and these. Every one is a plain number or a string on both
 * sides: no pointer, no struct and no object crosses this boundary.
 */
import { FFIType } from "bun:ffi";

const P = FFIType.ptr;
const I32 = FFIType.i32;
const F64 = FFIType.f64;
const CS = FFIType.cstring;

export const coreSymbols = {
	shim_screen_count: { args: [], returns: I32 },
	shim_screen_info: { args: [I32, P], returns: I32 },
	/** 1 when every clipboard entry point resolved on this machine. */
	shim_clipboard_ready: { args: [], returns: I32 },
	/** UTF-8 into the caller's buffer; the full length, 0 for no text, -1 for no clipboard. */
	shim_clipboard_read: { args: [P, I32], returns: I32 },
	/** 1 written, 0 refused, -1 the clipboard could not be opened. */
	shim_clipboard_write: { args: [CS, I32], returns: I32 },
	/** 1 the shell took the request, 0 it answered a `SE_ERR_*` code at or below 32. */
	shim_opener_open_path: { args: [CS, I32], returns: I32 },
	shim_opener_open_url: { args: [CS, I32], returns: I32 },
	shim_opener_reveal: { args: [CS, I32], returns: I32 },
	/** The step and the number behind the last refusal, as text. */
	shim_opener_reason_text: { args: [], returns: CS },
	/** Component 0/1/2 of `RtlGetVersion`: major, minor, build; -1 when unreadable. */
	shim_os_version: { args: [I32], returns: I32 },
	shim_os_locale: { args: [], returns: CS },
	/** Seconds since boot, from `GetTickCount64`. */
	shim_os_uptime: { args: [], returns: F64 },
};
