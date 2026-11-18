/**
 * The native edge: probe the machine, compile the shim, end the process. Everything the platform
 * needs from Windows goes through this interface, which is what lets the five `Platform` methods be
 * tested on a machine that has no user32 — no test ever reaches a real Win32 symbol.
 */
import type { WindowsNamespaceShim } from "./backend-namespaces.ts";
import type { WindowsWebViewShim } from "./backend-webview.ts";
import type { WindowsRuntimeReport } from "./preflight.ts";

// The real backend lives beside this file so the contract stays readable; defaultBackend is re-exported
// here because every importer already takes it from this module.
export { defaultBackend } from "./backend-default.ts";

/**
 * The shim's exports, as `ffi.ts` declares them. Every one takes and returns a number, a byte buffer
 * or nothing: no COM pointer, no vtable and no struct ever crosses this boundary.
 *
 * Every `cstring` argument is a `Uint8Array` from `cstring()`, never a JavaScript string —
 * `bun:ffi` throws on a string at that argument before C runs.
 *
 * **Composed from two interfaces on the same rule the modules follow.** The window, class, pump,
 * display and style members are here; the WebView2 calls are `WindowsWebViewShim` and the namespace
 * members — clipboard, opener, `os.info`, the file panels — are `WindowsNamespaceShim`. All three are
 * one type to a caller, which is what keeps `WindowsShim` the only thing the platform names.
 */
export interface WindowsShim extends WindowsWebViewShim, WindowsNamespaceShim {
	/**
	 * 1 when every Win32 entry point resolved, 0 when a module or an export was missing. Asked
	 * before any other call, because the pointers behind them are null until `12_win32.c` binds
	 * them — a call before this answers 1 is a null call, not a bad return.
	 */
	shim_win32_ready(): number;
	shim_com_init(): number;
	shim_last_error(): number;
	shim_register_class(name: Uint8Array): number;
	shim_pump(): number;
	shim_post_quit(): void;

	shim_window_new(
		title: Uint8Array,
		width: number,
		height: number,
		className: Uint8Array,
	): number;
	shim_window_is_open(hwnd: number): number;
	shim_window_set_title(hwnd: number, title: Uint8Array): number;
	shim_window_destroy(hwnd: number): number;
	/** The drag floor `WM_GETMINMAXINFO` answers with; 0 means no constraint on that axis. */
	shim_window_set_min(hwnd: number, width: number, height: number): void;
	shim_window_client_num(hwnd: number, component: number): number;
	/**
	 * The whole window rect — x, y, width, height of the frame `set_frame` moves — into a caller-owned
	 * `Int32Array(4)`. 1 written, 0 when `GetWindowRect` failed, which is the only way a closed handle
	 * is told from a zero-sized window: a component of 0 is a legal coordinate. Client size is
	 * `shim_window_client_num`; these are not the same number, and `setSize` means the frame.
	 */
	shim_window_frame(hwnd: number, out: Int32Array): number;
	/**
	 * `WINDOWPLACEMENT.rcNormalPosition` into `out`: the rect the window returns to when it is
	 * un-minimised or un-maximised. `shim_window_frame` answers the iconic off-screen rect for a
	 * minimised window and the monitor for a maximised one, so neither is a frame worth saving.
	 */
	shim_window_normal_frame(hwnd: number, out: Int32Array): number;
	/** One component of the monitor the window is on: 0 x, 1 y, 2 width, 3 height. */
	shim_window_monitor_num(hwnd: number, component: number): number;
	/** `SetWindowPos` with SWP_NOZORDER | SWP_NOACTIVATE: geometry only, never a raise. 1 on success. */
	shim_window_set_frame(
		hwnd: number,
		x: number,
		y: number,
		width: number,
		height: number,
	): number;
	/** `ShowWindow`: 0 minimize, 1 maximize, 2 restore. */
	shim_window_show(hwnd: number, verb: number): number;
	shim_window_is_minimized(hwnd: number): number;
	shim_window_is_maximized(hwnd: number): number;
	/**
	 * `SetWindowPos(HWND_TOPMOST | HWND_NOTOPMOST, SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE)` and the
	 * `WS_EX_TOPMOST` bit it writes. The read-back is the OS's, not a flag this layer keeps, so an
	 * always-on-top that Windows refused reads back false rather than as the value asked for.
	 */
	shim_window_set_topmost(hwnd: number, on: number): number;
	shim_window_is_topmost(hwnd: number): number;
	/** `WS_OVERLAPPEDWINDOW`'s five bits, cleared or restored, then read back from `GWL_STYLE`. */
	shim_window_set_decorated(hwnd: number, on: number): number;
	shim_window_is_decorated(hwnd: number): number;
	/** `WS_EX_LAYERED` plus `SetLayeredWindowAttributes`: alpha is 0..255, and it is clamped here. */
	shim_window_set_alpha(hwnd: number, alpha: number): number;
	/** The applied alpha, 0..255; 255 when the window is not layered; -1 when it cannot be read. */
	shim_window_alpha(hwnd: number): number;
	/**
	 * `GWL_STYLE` into `out`, 1 written / 0 failed. An out parameter because a style of 0 is legal
	 * (`WS_OVERLAPPED`), so a 0 return could not be told from a refused call.
	 */
	shim_window_style(hwnd: number, out: Int32Array): number;
	/** Write `GWL_STYLE`, refresh the non-client area, then read it back: 1 when it took. */
	shim_window_set_style(hwnd: number, style: number): number;
	/** One cursor name as a number: 0 default, 1 pointer, 2 crosshair, 3 text, 4 grab. 1 on success. */
	shim_cursor_set(kind: number): number;
	/** `ShowCursor` driven to the side asked for; the count it ended on (>= 0 is visible). */
	shim_cursor_show(visible: number): number;
	/** `SetForegroundWindow`; 0 is the foreground lock refusing, which the adapter reports. */
	shim_window_focus(hwnd: number): number;
	/** HRESULT of DwmSetWindowAttribute(38); negative sentinels mean dwmapi could not be used. */
	shim_window_set_material(hwnd: number, kind: number): number;

	/** How many displays the machine has; 0 when Win32 could not be asked. */
	shim_screen_count(): number;
	/**
	 * Ten doubles for one display, in top-left pixels: frame x/y/w/h, work area x/y/w/h, scale,
	 * then 1 when it is the primary. 1 written, 0 when the index names nothing.
	 */
	shim_screen_info(index: number, out: Float64Array): number;
}

export interface WindowsBackend {
	/** Read the WebView2 runtime and the Windows build number without compiling anything. */
	probe(): WindowsRuntimeReport;
	/** Compile the shim and return its symbols; throws when the C unit will not build. */
	load(): WindowsShim;
	/** End the process. Injected so a test can watch a quit without exiting the runner. */
	exit(code: number): void;
}
