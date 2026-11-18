/**
 * The fake's WebView2 members — the environment, the controller, the attach and the handler ABI read
 * back — split out of `fake-shim.ts` when that table passed the line cap, along the same seam
 * `backend-webview.ts` splits the real interface.
 *
 * Each answers from `FakeOptions`, so one fake covers a webview that attached and one that refused.
 */
import type { WindowsShim } from "./backend.ts";
import type { FakeOptions } from "./fake-backend.ts";
import { text } from "./fake-bytes.ts";

export type FakeWebViewShim = Pick<
	WindowsShim,
	| "shim_webview_new"
	| "shim_webview_put_bounds"
	| "shim_webview_close"
	| "shim_env_begin"
	| "shim_env_wait"
	| "shim_env_callback"
	| "shim_controller_begin"
	| "shim_controller_wait"
	| "shim_controller_callback"
	| "shim_webview_attach"
	| "shim_navigate_hresult"
	| "shim_webview_source"
	| "shim_webview_navigate_string"
	| "shim_controller_visible"
	| "shim_webview_navigate"
	| "shim_env_hresult"
	| "shim_controller_hresult"
	| "shim_thread_at"
	| "shim_thread_id"
	| "shim_window_thread"
	| "shim_apartment_type"
	| "shim_apartment_bound"
	| "shim_apartment_hresult"
	| "shim_apartment_qualifier"
	| "shim_object_state"
	| "shim_bad_object"
	| "shim_object_bytes"
	| "shim_handler_created"
	| "shim_handler_addref"
	| "shim_env_inline"
	| "shim_ctrl_from"
	| "shim_ctrl_inline"
	| "shim_ctrl_mode"
	| "shim_controller_addr"
	| "shim_environment_addr"
	| "shim_controller_vtbl"
	| "shim_controller_slot"
	| "shim_webview_vtbl"
	| "shim_webview_slot"
	| "shim_bad_slot"
	| "shim_webview_handle"
	| "shim_attach_hresult"
	| "shim_webview_bind"
	| "shim_webview_size"
	| "shim_handler_prepare"
	| "shim_handler_vtbl_addr"
	| "shim_handler_object_addr"
	| "shim_handler_first_field"
	| "shim_handler_entry"
>;

export function fakeWebView(calls: string[], options: FakeOptions = {}): FakeWebViewShim {
	return {
		shim_webview_new: (_hwnd, url) => {
			calls.push(`webview_new:${text(url)}`);
			return options.failWebView ? 0 : 1;
		},
		shim_webview_put_bounds: (_hwnd, width, height) => {
			calls.push(`bounds:${width}x${height}`);
			return 1;
		},
		shim_webview_close: () => {
			calls.push("webview_close");
		},

		// The WebView2 steps, in the same order the platform would make them.
		shim_env_begin: () => {
			calls.push("env_begin");
			return 0;
		},
		shim_env_wait: () => {
			calls.push("env_wait");
			return options.failWebView ? 0 : 1;
		},
		shim_env_callback: () => 0,
		shim_controller_begin: () => {
			calls.push("controller_begin");
			return 0;
		},
		shim_controller_wait: () => {
			calls.push("controller_wait");
			return options.failWebView ? 0 : 1;
		},
		shim_controller_callback: () => 0,
		shim_webview_attach: () => {
			calls.push("webview_attach");
			return options.failWebView ? 0 : 1;
		},
		shim_navigate_hresult: () => 0,
		shim_webview_source: () => 0,
		shim_webview_navigate_string: () => 1,
		shim_controller_visible: () => 0,
		shim_webview_navigate: (_url) => {
			calls.push("webview_navigate");
			return options.failWebView ? 0 : 1;
		},
		shim_env_hresult: () => 0,
		shim_controller_hresult: () => (options.failWebView ? -2147467259 : 0),
		shim_thread_at: () => 4242,
		shim_thread_id: () => 4242,
		shim_window_thread: () => 4242,
		shim_apartment_type: () => 0,
		shim_apartment_bound: () => 1,
		shim_apartment_hresult: () => 0,
		shim_apartment_qualifier: () => 0,
		shim_object_state: () => 0,
		shim_bad_object: () => 0,
		shim_object_bytes: (_obj, out) => out.length,
		shim_handler_created: () => 0x2000,
		shim_handler_addref: () => 1,
		shim_env_inline: () => 0,
		shim_ctrl_from: () => 2,
		shim_ctrl_inline: () => 0,
		shim_ctrl_mode: () => 1,
		shim_controller_addr: () => 0x2000,
		shim_environment_addr: () => 0x2100,
		shim_controller_vtbl: () => 0x3000,
		shim_controller_slot: () => 0x4000,
		shim_webview_vtbl: () => 0x6000,
		shim_webview_slot: () => 0x7000,
		shim_bad_slot: () => -1,
		shim_webview_handle: () => 0x5000,
		shim_attach_hresult: () => 0,
		shim_webview_bind: () => {
			calls.push("webview_bind");
			return options.failWebView ? 0 : 1;
		},
		shim_webview_size: () => {
			calls.push("webview_size");
			return options.failWebView ? 0 : 1;
		},

		// The handler readback: a table at 0x1000, an object whose first field is that table.
		shim_handler_prepare: () => 1,
		shim_handler_vtbl_addr: () => 0x1000,
		shim_handler_object_addr: () => 0x2000,
		shim_handler_first_field: () => 0x1000,
		shim_handler_entry: () => 0x3000,
	};
}
