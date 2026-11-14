// bun:ffi types a pointer as a nominal number and a `ptr` argument as
// Pointer|TypedArray|bigint, while the runtime value here is always a plain
// number. One cast at compile() keeps every call site honest numbers and every
// guard in this file unchanged.
type LooseSymbol = (
	...args: Array<number | bigint | string | null | undefined>
) => number | bigint | string | null | undefined;

export interface Shim {
	symbols: {
		shim_cls: LooseSymbol;
		shim_sel: LooseSymbol;
		shim_object_class: LooseSymbol;
		shim_class_name: LooseSymbol;
		shim_name_of_class: LooseSymbol;
		shim_instance_method: LooseSymbol;
		shim_responds: LooseSymbol;

		shim_send_p0: LooseSymbol;
		shim_send_p1: LooseSymbol;
		shim_send_p2: LooseSymbol;
		shim_send_p3: LooseSymbol;
		shim_send_pq1: LooseSymbol;
		shim_send_pd1: LooseSymbol;
		shim_send_pb1: LooseSymbol;

		shim_send_b0: LooseSymbol;
		shim_send_b1: LooseSymbol;
		shim_send_q0: LooseSymbol;
		shim_send_q1: LooseSymbol;

		shim_send_v0: LooseSymbol;
		shim_send_v1: LooseSymbol;
		shim_send_v2: LooseSymbol;
		shim_send_vb1: LooseSymbol;
		shim_send_vq1: LooseSymbol;
		shim_send_vd1: LooseSymbol;

		shim_new: LooseSymbol;
		shim_cstr_len: LooseSymbol;
		shim_webview_load: LooseSymbol;

		shim_constraint: LooseSymbol;
		shim_constraint_simple: LooseSymbol;
		shim_frame_num: LooseSymbol;
		shim_window_new: LooseSymbol;
		shim_window_set_min_size: LooseSymbol;
		shim_window_set_title: LooseSymbol;
		shim_window_title_utf8: LooseSymbol;
		shim_window_number: LooseSymbol;
		shim_window_is_visible: LooseSymbol;
		shim_window_is_released_when_closed: LooseSymbol;
		shim_window_is_key: LooseSymbol;
		shim_window_is_miniaturized: LooseSymbol;

		shim_on_main_runloop: LooseSymbol;
		shim_window_is_on_active_space: LooseSymbol;

		shim_app_load: LooseSymbol;
		shim_pool_new: LooseSymbol;
		shim_pool_init: LooseSymbol;
		shim_pool_drain: LooseSymbol;

		shim_menu_install: LooseSymbol;
		shim_menu_ready: LooseSymbol;
		shim_menu_has: LooseSymbol;

		shim_mode: LooseSymbol;
		shim_mode_ok: LooseSymbol;
		shim_pump: LooseSymbol;

		shim_open_panel: LooseSymbol;
		shim_open_panel_count: LooseSymbol;
		shim_open_panel_path: LooseSymbol;
		shim_save_panel: LooseSymbol;

		shim_sheet_done: LooseSymbol;
		shim_sheet_response: LooseSymbol;
		shim_sheet_cancel: LooseSymbol;
		shim_sheet_kind: LooseSymbol;
	};
}
