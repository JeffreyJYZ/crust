/**
 * The fake's numbers half: the environment and controller steps, the thread and apartment readbacks,
 * the object and handler ABI. Split from `fake-webview.ts` when the surface table pushed that file to
 * the line cap, on the same seam `backend-webview.ts` splits the real members — surface behaviour in
 * one file, "what is this pointer" in the other.
 *
 * Nothing here touches the surface table: a step is one call in the log, and a readback is a constant
 * unless `FakeOptions` says a machine is broken. So the fake still covers a healthy runtime and a
 * refused one without modelling WebView2 twice.
 */
import type { WindowsShim } from "./backend.ts";
import type { FakeOptions } from "./fake-backend.ts";

export type FakeWebViewProbeShim = Pick<
	WindowsShim,
	| "shim_env_begin"
	| "shim_env_wait"
	| "shim_env_callback"
	| "shim_controller_begin"
	| "shim_controller_wait"
	| "shim_controller_callback"
	| "shim_controller_visible"
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
	| "shim_bad_slot"
	| "shim_handler_prepare"
	| "shim_handler_vtbl_addr"
	| "shim_handler_object_addr"
	| "shim_handler_first_field"
	| "shim_handler_entry"
>;

export function fakeWebViewProbe(calls: string[], options: FakeOptions = {}): FakeWebViewProbeShim {
	return {
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
		shim_controller_visible: () => 0,
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
		shim_bad_slot: () => -1,

		// The handler readback: a table at 0x1000, an object whose first field is that table.
		shim_handler_prepare: () => 1,
		shim_handler_vtbl_addr: () => 0x1000,
		shim_handler_object_addr: () => 0x2000,
		shim_handler_first_field: () => 0x1000,
		shim_handler_entry: () => 0x3000,
	};
}
