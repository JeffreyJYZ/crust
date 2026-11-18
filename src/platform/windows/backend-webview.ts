/**
 * The WebView2 half of the shim — the environment, the controller, the attach, and the probe
 * functions that read an object's vtable back — split out of `backend.ts` when that interface passed
 * the line cap.
 *
 * The seam is the browser: every member here is a call on a WebView2 object or a number read out of
 * one, and none of them is needed to place, size or style a window. `WindowsShim` extends this, so
 * every caller still takes one type.
 */

export interface WindowsWebViewShim {
	shim_webview_new(hwnd: number, url: Uint8Array, userData: Uint8Array): number;
	shim_webview_put_bounds(hwnd: number, width: number, height: number): number;
	shim_webview_close(hwnd: number): void;

	/**
	 * The WebView2 path, one step at a time — the same functions `shim_webview_new` composes. A crash
	 * inside a hand-built COM object is a jump, not an error code, so each step is separately callable
	 * and each reports the HRESULT of its own call and of the callback that answered it.
	 */
	shim_env_begin(hwnd: number, userData: Uint8Array): number;
	shim_env_wait(): number;
	shim_env_callback(): number;
	shim_controller_begin(hwnd: number): number;
	shim_controller_wait(): number;
	shim_controller_callback(): number;
	shim_webview_attach(hwnd: number): number;
	shim_webview_navigate(url: Uint8Array): number;
	/** The HRESULT `Navigate` returned, for the print after the call. */
	shim_navigate_hresult(): number;
	/** `ICoreWebView2::get_Source` — S_OK proves the webview object is callable at all. */
	shim_webview_source(): number;
	/** `ICoreWebView2::NavigateToString` — the same string path with the URL parse removed. */
	shim_webview_navigate_string(): number;
	/** `ICoreWebView2Controller::put_IsVisible(TRUE)` — the call every sample makes and this layer never did. */
	shim_controller_visible(): number;

	/**
	 * The attach in its two halves — `get_CoreWebView2` (controller slot 25) and `put_Bounds` (slot 6, a
	 * 16-byte struct by reference) — so a fault names which one. `shim_attach_hresult(0|1)` is the
	 * HRESULT of each, and `shim_webview_handle` the ICoreWebView2 the first produced.
	 */
	shim_webview_bind(hwnd: number): number;
	shim_webview_size(hwnd: number): number;
	shim_webview_handle(): number;
	shim_attach_hresult(which: number): number;

	/** 1 when the environment callback fired inside `create_env`, not in a later pump iteration. */
	shim_env_inline(): number;
	/** Where the controller call was made: 2 after `create_env` returned, 3 after a pump, 4 the fallback. */
	shim_ctrl_from(): number;
	/** 1 when the controller completion fired inside `CreateCoreWebView2Controller`, 0 from a pump. */
	shim_ctrl_inline(): number;
	/** 1 = deferral (default), 2 = create from `shim_controller_begin`; returns the previous mode. */
	shim_ctrl_mode(mode: number): number;

	/**
	 * The thread that owns a window, and the apartment this thread is in — 0 STA, 1 MTA, 2 neutral,
	 * 3 main STA, -1 not initialised. `com_init` answering S_OK is the claim; these are the check, and
	 * `shim_apartment_bound` separates "never bound" from "the call failed".
	 */
	shim_window_thread(hwnd: number): number;
	shim_apartment_type(): number;
	shim_apartment_bound(): number;
	shim_apartment_hresult(): number;
	/** APTTYPEQUALIFIER beside the type. The qualifier out-param is not optional: NULL answered E_INVALIDARG. */
	shim_apartment_qualifier(): number;

	/**
	 * 0 when the object reads and its first field reads, 1 when the object does not, 2 when the vtable
	 * does not — the difference between "the pointer is garbage" and "one entry is bad".
	 */
	shim_object_state(obj: number): number;
	shim_bad_object(): number;
	/** The first `words` 32-bit words of `obj`, into a caller-owned buffer; 0 when unreadable. */
	shim_object_bytes(obj: number, out: Uint32Array, words: number): number;
	/** What WebView2 handed the callback for a step — compare with what `result` holds now. */
	shim_handler_created(step: number): number;
	/** The refcount `AddRef` answered for that object: > 0 taken, 0 refused, -1 unreadable. */
	shim_handler_addref(step: number): number;

	/**
	 * The controller object, as Windows will read it: its address, the environment's (equal addresses
	 * mean the wrong one was stored), its vtable pointer, and one entry of it. Compared with
	 * `shim_handler_vtbl_addr`, this says whether the object is a controller at all.
	 */
	shim_controller_addr(): number;
	shim_environment_addr(): number;
	shim_controller_vtbl(): number;
	shim_controller_slot(index: number): number;

	/** The ICoreWebView2's vtable and one entry, so a bad webview is printed before `Navigate`. */
	shim_webview_vtbl(): number;
	shim_webview_slot(index: number): number;

	/**
	 * The last vtable slot a call refused — `0`, `(void *)-1` or memory that is not committed and
	 * executable — or -1. A refused slot returns `E_NOINTERFACE` instead of jumping, so a probe can
	 * still print the next line.
	 */
	shim_bad_slot(): number;

	/**
	 * The HRESULT of the last begin call. `shim_webview_new` answers 0/1, so a caller that needs the
	 * reason reads it here: a refused call and a callback that never arrived are different defects.
	 */
	shim_env_hresult(): number;
	shim_controller_hresult(): number;

	/**
	 * Which thread each step ran on — `0` COM init, `1` environment call, `2` environment callback,
	 * `3` controller call, `4` controller callback — plus the calling thread now. `UI_E_WRONG_THREAD`
	 * (0x802A000C) is what a mismatch looks like, so these are the numbers that settle it.
	 */
	shim_thread_at(step: number): number;
	shim_thread_id(): number;

	/**
	 * The handler object's ABI, read back the way Windows reads it: 1 when the object's first field
	 * is the table, then the table's address, the object's address, that first field, and each entry.
	 * A pointer where a vtable should be is the difference between a callback and a jump to -1.
	 */
	shim_handler_prepare(): number;
	shim_handler_vtbl_addr(): number;
	shim_handler_object_addr(): number;
	shim_handler_first_field(): number;
	shim_handler_entry(index: number): number;
}
