/**
 * The `bun:ffi` declarations for the preview host — the shell's `IPreviewHandler` over
 * `54_preview.c`–`55_preview_init.c`.
 *
 * Its own table for the reason `ffi-dialog.ts` has one: this is one plugin's surface, and it is the
 * only one whose entry points are bound on first use rather than at launch, so a machine missing
 * shlwapi refuses `preview` and still opens a window.
 *
 * Two answers carry a failure: `shim_preview_show`'s status (0 shown, 1 no-handler, 2 preview-failed),
 * and the step and HRESULT behind it. The HRESULT is declared `i64` — the one widened return, so the
 * sign of `0x80004005` survives into JavaScript and a caller can print what Windows answered.
 */
import { FFIType } from "bun:ffi";

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;
const CS = FFIType.cstring;

export const previewSymbols = {
	/** 1 when shlwapi, ole32 and shell32 export everything below; 0 names no step and no HRESULT. */
	shim_preview_ready: { args: [], returns: I32 },
	/**
	 * Resolve, create, initialise and render, all in one call. `x`/`y`/`w`/`h` are the child window's
	 * rectangle in the parent's client area; `parent` is the app window's HWND.
	 */
	shim_preview_show: { args: [CS, I32, P, I32, I32, I32, I32], returns: I32 },
	/** Unload, release and destroy the child window. 1 always: hiding twice is not an error. */
	shim_preview_hide: { args: [], returns: I32 },
	/** `SetWindowPos` the child, then `SetRect` the handler. 1 moved, 0 nothing is showing. */
	shim_preview_size: { args: [I32, I32, I32, I32], returns: I32 },
	/** The host window, 0 when nothing is shown. */
	shim_preview_hwnd: { args: [], returns: P },
	/** Which step the last `show` reached: 0 none, 1 resolve, 2 create, 3 initialise, 4 SetWindow,
	 * 5 SetRect, 6 DoPreview, 7 host window, 8 entry points. */
	shim_preview_step: { args: [], returns: I32 },
	/** The HRESULT that stopped that step, sign-extended; 0 when it was not a COM refusal. */
	shim_preview_hresult: { args: [], returns: I64 },
};
