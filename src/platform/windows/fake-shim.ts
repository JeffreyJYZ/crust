/**
 * The symbol table a test drives: every entry of `WindowsShim`, recording into a call log instead of
 * reaching Windows. Split from `fake-backend.ts` when that file outgrew the line cap, and exported on
 * its own so a test that only needs to record a few arguments can spread it and override those.
 */
import type { WindowsShim } from "./backend.ts";
import type { FakeOptions } from "./fake-backend.ts";

/**
 * The UTF-8 a `cstring` argument carries, minus its terminator. The fake records readable call
 * names, so a test can still assert `window_new:Crust Test:900x640:crust-test` while the buffer
 * itself is checked in `cstring.test.ts`.
 */
function text(value: Uint8Array): string {
	return Buffer.from(value).toString("utf8").replace(/\0$/, "");
}

/**
 * The shim a test drives, with its call log. Exported on its own so a test that only needs to record
 * a few arguments can spread this and override those, instead of restating all 27 methods.
 */
export function fakeShim(
	options: FakeOptions = {},
	calls: string[] = [],
	hwnds: number[] = [],
	open: Set<number> = new Set(),
): WindowsShim {
	let next = 100;

	return {
		shim_win32_ready: () => {
			calls.push("win32_ready");
			return options.win32Ready ?? 1;
		},
		shim_com_init: () => {
			calls.push("com_init");
			return options.comInit ?? 0;
		},
		shim_last_error: () => 87,
		shim_register_class: (name) => {
			calls.push(`register_class:${text(name)}`);
			return options.classAtom ?? 1;
		},
		shim_pump: () => {
			calls.push("pump");
			return 0;
		},
		shim_post_quit: () => {
			calls.push("post_quit");
		},
		shim_window_new: (title, width, height, className) => {
			calls.push(`window_new:${text(title)}:${width}x${height}:${text(className)}`);
			if (options.failWindow) return 0;
			const hwnd = next++;
			hwnds.push(hwnd);
			open.add(hwnd);
			return hwnd;
		},
		shim_window_is_open: (hwnd) => (open.has(Number(hwnd)) ? 1 : 0),
		shim_window_set_title: (_hwnd, title) => {
			calls.push(`set_title:${text(title)}`);
			return 1;
		},
		shim_window_destroy: (hwnd) => {
			calls.push("window_destroy");
			open.delete(Number(hwnd));
			return 1;
		},
		shim_window_client_num: (_hwnd, component) => (component === 2 ? 800 : 600),
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
