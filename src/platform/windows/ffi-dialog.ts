/**
 * The `bun:ffi` declarations for the file panels — comdlg32's `GetOpenFileNameW`/`GetSaveFileNameW`
 * and shell32's folder picker, over the C parts `48_dialog.c`–`49_dialog.c`.
 *
 * Split out of `ffi.ts` when that file reached the line cap, and because the table reads as its own
 * responsibility: six entry points, one of them the only one that can fail with a Win32 code rather
 * than a status. No pointer crosses the boundary except the owner HWND, which is a number here.
 */
import { FFIType } from "bun:ffi";

const P = FFIType.ptr;
const I32 = FFIType.i32;
const CS = FFIType.cstring;

export const dialogSymbols = {
	shim_dialog_open: { args: [CS, CS, I32, I32, P], returns: I32 },
	shim_dialog_save: { args: [CS, CS, CS, P], returns: I32 },
	/** How many paths the last pick answered with; 0 after a cancel. */
	shim_dialog_count: { args: [], returns: I32 },
	shim_dialog_path: { args: [I32], returns: CS },
	/** `CommDlgExtendedError` from the last refused call, or 0. */
	shim_dialog_error: { args: [], returns: FFIType.u32 },
	/** The entry point that did not resolve; empty when the panels are usable. */
	shim_dialog_missing: { args: [], returns: CS },
};
