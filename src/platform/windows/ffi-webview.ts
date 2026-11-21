/**
 * The WebView2 half of the `cc()` symbol table: the surface table's entry points, the environment and
 * controller steps, and the probe readbacks that describe an object. Split out of `ffi.ts` when that
 * file reached the line cap — the same seam that keeps `backend-webview.ts` apart from `backend.ts`,
 * and the same rule `ffi-core.ts` and `ffi-dialog.ts` follow.
 *
 * Every call whose subject is one surface takes the handle from `41_surfaces.c` — 0 for the app's own
 * window — so a second webview is addressable without a second window.
 */
import { FFIType } from "bun:ffi";

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;
const F64 = FFIType.f64;
const V = FFIType.void;
const CS = FFIType.cstring;

export const webviewSymbols = {
	shim_webview_new: { args: [P, CS, CS], returns: I32 },
	shim_webview_put_bounds: { args: [P, F64, F64], returns: I32 },
	shim_webview_close: { args: [P], returns: V },
	shim_webview_live: { args: [], returns: I32 },

	// The handle table: `shim_webview_index` is how a window's handle is learned, and
	// `shim_webview_set_bounds` is `put_Bounds` on that surface's own controller — the call that turns
	// a second webview into a second webview *somewhere*.
	shim_webview_index: { args: [P], returns: I32 },
	shim_webview_set_bounds: { args: [I32, F64, F64, F64, F64], returns: I32 },
	shim_webview_bound: { args: [I32, I32], returns: F64 },

	// The WebView2 path, one step at a time, so a probe can print between them.
	shim_env_begin: { args: [P, CS], returns: I64 },
	shim_env_wait: { args: [], returns: I32 },
	shim_env_callback: { args: [], returns: I64 },
	shim_controller_begin: { args: [P], returns: I64 },
	shim_controller_wait: { args: [], returns: I32 },
	shim_controller_callback: { args: [], returns: I64 },
	shim_webview_attach: { args: [P], returns: I32 },
	shim_webview_navigate: { args: [I32, CS], returns: I32 },
	shim_navigate_hresult: { args: [I32], returns: I32 },
	shim_webview_source: { args: [I32], returns: I32 },
	shim_webview_navigate_string: { args: [I32], returns: I32 },
	shim_controller_visible: { args: [I32], returns: I32 },
	shim_webview_bind: { args: [P], returns: I32 },
	shim_webview_size: { args: [P], returns: I32 },
	shim_webview_handle: { args: [I32], returns: P },
	shim_attach_hresult: { args: [I32, I32], returns: I64 },
	shim_env_inline: { args: [], returns: I32 },
	shim_ctrl_from: { args: [], returns: I32 },
	shim_ctrl_inline: { args: [], returns: I32 },
	shim_ctrl_mode: { args: [I32], returns: I32 },
	shim_window_thread: { args: [P], returns: I32 },
	shim_apartment_type: { args: [], returns: I32 },
	shim_apartment_bound: { args: [], returns: I32 },
	shim_apartment_hresult: { args: [], returns: I64 },
	shim_apartment_qualifier: { args: [], returns: I32 },
	shim_object_state: { args: [P], returns: I32 },
	shim_bad_object: { args: [], returns: I32 },
	shim_object_bytes: { args: [P, P, I32], returns: I32 },
	shim_handler_created: { args: [I32], returns: P },
	shim_handler_addref: { args: [I32], returns: I32 },
	shim_controller_addr: { args: [], returns: P },
	shim_environment_addr: { args: [], returns: P },
	shim_controller_vtbl: { args: [], returns: P },
	shim_controller_slot: { args: [I32], returns: P },
	shim_webview_vtbl: { args: [I32], returns: P },
	shim_webview_slot: { args: [I32, I32], returns: P },
	shim_bad_slot: { args: [], returns: I32 },

	// The reason behind a 0/1, and the threads each step ran on.
	shim_env_hresult: { args: [], returns: I64 },
	shim_controller_hresult: { args: [], returns: I64 },
	shim_thread_at: { args: [I32], returns: FFIType.u32 },
	shim_thread_id: { args: [], returns: FFIType.u32 },

	// The handler object's ABI, as the numbers Windows would read.
	shim_handler_prepare: { args: [], returns: I32 },
	shim_handler_vtbl_addr: { args: [], returns: P },
	shim_handler_object_addr: { args: [], returns: P },
	shim_handler_first_field: { args: [], returns: P },
	shim_handler_entry: { args: [I32], returns: P },

	// The browser surface's own table. `57_browser.c` adds the child window and the reads;
	// `58_browser_events.c` adds the navigation and new-window handlers.
	shim_child_new: { args: [P, I32, I32, I32, I32], returns: P },
	shim_child_move: { args: [P, I32, I32, I32, I32], returns: I32 },
	shim_webview_url_text: { args: [I32, P, I32], returns: I32 },
	shim_webview_title_text: { args: [I32, P, I32], returns: I32 },
	shim_webview_can_go_back: { args: [I32], returns: I32 },
	shim_webview_can_go_forward: { args: [I32], returns: I32 },
	shim_webview_loading: { args: [I32], returns: I32 },
	shim_browser_surface_new: { args: [P, CS, CS], returns: I32 },
	shim_webview_watch: { args: [I32], returns: I32 },
	shim_webview_refuse_popups: { args: [I32], returns: I32 },
	shim_browser_set_sink: { args: [P], returns: V },
	shim_browser_popups: { args: [], returns: I32 },
	shim_browser_popup_url: { args: [P, I32], returns: I32 },
	shim_browser_nav_url: { args: [P, I32], returns: I32 },
} as const;
