/**
 * The `bun:ffi` declaration map for the Linux shim — every entry point `shim()` hands back, as JS
 * sees it. Split out of `shim-ffi.ts` when that file reached the line cap, and because the map and
 * the compile step are two responsibilities: the map is a table, and `shim-ffi.ts` is the one
 * compile per process plus the error translation.
 *
 * Every `cstring` argument is a NUL-terminated byte buffer, never a JavaScript string — bun:ffi
 * throws on one, measured against real GTK. Every pointer is opaque: no struct and no object crosses
 * this boundary in either direction.
 */
import { FFIType } from "bun:ffi";

const P = FFIType.ptr;
const I32 = FFIType.i32;
const V = FFIType.void;
const CS = FFIType.cstring;

export const shimSymbols = {
	shim_lib_open: { args: [], returns: I32 },
	shim_lib_error_text: { args: [], returns: CS },

	shim_gtk_init: { args: [], returns: I32 },
	shim_pump: { args: [], returns: I32 },

	shim_window_new: { args: [CS, I32, I32, I32, I32], returns: P },
	shim_window_container: { args: [P], returns: P },
	shim_window_attach: { args: [P, P], returns: I32 },
	shim_window_show: { args: [P], returns: V },
	shim_window_destroy: { args: [P], returns: V },
	shim_window_alive: { args: [P], returns: I32 },

	shim_webview_new: { args: [], returns: P },
	shim_webview_load: { args: [P, CS], returns: I32 },
	// A surface is placed into a window's container at a rectangle in points: box, view, x, y, w, h.
	shim_webview_place: { args: [P, P, I32, I32, I32, I32], returns: I32 },

	shim_window_api_ready: { args: [], returns: I32 },
	shim_window_api_missing: { args: [], returns: CS },
	shim_window_present: { args: [P], returns: I32 },
	shim_window_set_title: { args: [P, CS], returns: I32 },
	shim_window_title: { args: [P], returns: CS },
	shim_window_resize: { args: [P, I32, I32], returns: I32 },
	shim_window_size: { args: [P, P], returns: I32 },
	shim_window_placeable: { args: [], returns: I32 },
	shim_window_move: { args: [P, I32, I32], returns: I32 },
	shim_window_position: { args: [P, P], returns: I32 },
	shim_window_state: { args: [P], returns: I32 },
	shim_window_flag: { args: [P, I32, I32], returns: I32 },
	shim_window_keep_above: { args: [P, I32], returns: I32 },
	shim_window_set_decorated: { args: [P, I32], returns: I32 },
	shim_window_decorated: { args: [P], returns: I32 },
	shim_widget_set_opacity: { args: [P, FFIType.f64], returns: I32 },
	shim_widget_opacity: { args: [P], returns: FFIType.f64 },

	shim_screen_ready: { args: [], returns: I32 },
	shim_screen_count: { args: [], returns: I32 },
	shim_screen_info: { args: [I32, P], returns: I32 },

	// The three namespaces a normal app reaches first: `80`–`82`, resolved lazily.
	shim_clipboard_ready: { args: [], returns: I32 },
	shim_clipboard_read: { args: [P, I32], returns: I32 },
	shim_clipboard_write: { args: [CS, I32], returns: I32 },
	shim_opener_ready: { args: [], returns: I32 },
	shim_opener_open_path: { args: [CS, I32], returns: I32 },
	shim_opener_open_url: { args: [CS, I32], returns: I32 },
	shim_opener_reason_text: { args: [], returns: CS },
	shim_os_locale_ready: { args: [], returns: I32 },
	shim_os_locale: { args: [], returns: CS },

	shim_keyring_open: { args: [], returns: I32 },
	shim_keyring_set: { args: [CS, CS, CS], returns: I32 },
	shim_keyring_get: { args: [CS, CS, P], returns: CS },
	shim_keyring_delete: { args: [CS, CS], returns: I32 },

	shim_dialog_ready: { args: [], returns: I32 },
	shim_dialog_missing: { args: [], returns: CS },
	shim_dialog_open: { args: [CS, CS, I32, I32, P], returns: I32 },
	shim_dialog_save: { args: [CS, CS, CS, P], returns: I32 },
	shim_dialog_status: { args: [], returns: I32 },
	shim_dialog_count: { args: [], returns: I32 },
	shim_dialog_path: { args: [I32], returns: CS },
	shim_dialog_cancel: { args: [], returns: I32 },
	shim_dialog_release: { args: [], returns: V },

	shim_webview_title: { args: [P], returns: CS },
	// Keyed by the view: two webviews in one window answer for themselves.
	shim_webview_load_state: { args: [P], returns: I32 },
	shim_webview_load_text: { args: [P], returns: CS },
	shim_webview_eval: { args: [P, CS], returns: I32 },
	shim_webview_eval_state: { args: [P], returns: I32 },
	shim_webview_eval_text: { args: [P], returns: CS },
};
