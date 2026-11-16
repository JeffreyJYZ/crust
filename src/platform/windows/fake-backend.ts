/**
 * A `WindowsBackend` that records calls instead of reaching Windows. Every test in this directory
 * uses it: no Win32 symbol can run on the machine this suite runs on, and an injected fake is the
 * only way the five `Platform` methods are testable at all.
 */
import type { WindowsBackend, WindowsShim } from "./backend.ts";
import type { WindowsRuntimeReport } from "./preflight.ts";

export interface FakeOptions {
	/** Override any probe field, so one fake covers a healthy and a broken machine. */
	report?: Partial<WindowsRuntimeReport>;
	/** Return 0 from `shim_window_new`, as a refused CreateWindowExW does. */
	failWindow?: boolean;
	/** Return 0 from `shim_webview_new`, as a runtime that never answers does. */
	failWebView?: boolean;
	/** What `shim_com_init` returns; negative is a failed apartment. */
	comInit?: number;
	/** What `shim_register_class` returns; 0 is a class that never registered. */
	classAtom?: number;
	/** What `shim_win32_ready` returns; 0 is a machine whose entry points did not resolve. */
	win32Ready?: number;
	/** Make `load()` throw, as a C unit that will not build does. */
	loadThrows?: boolean;
}

export interface FakeBackend extends WindowsBackend {
	/** Every call the platform made, in order, as `name:detail`. */
	calls: string[];
	/** Every code passed to `exit`. */
	exits: number[];
	/** Every hwnd handed out, in creation order. */
	hwnds: number[];
	/** The probe result, mutable after construction. */
	report: WindowsRuntimeReport;
	/** Simulate the human closing a window, so liveness has something to answer. */
	closeWindow(hwnd: number): void;
}

const HEALTHY: WindowsRuntimeReport = {
	buildNumber: "10.0.22631",
	loader: true,
	coreVersion: "120.0.2210.91",
};

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
		shim_webview_navigate: (_url) => {
			calls.push("webview_navigate");
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

/** The real backend, with a shim that records instead of reaching Windows. */
export function fakeBackend(options: FakeOptions = {}): FakeBackend {
	const calls: string[] = [];
	const exits: number[] = [];
	const hwnds: number[] = [];
	const report: WindowsRuntimeReport = { ...HEALTHY, ...options.report };
	const open = new Set<number>();
	const shim = fakeShim(options, calls, hwnds, open);

	return {
		calls,
		exits,
		hwnds,
		report,
		probe: () => report,
		load: () => {
			calls.push("load");
			if (options.loadThrows) throw new Error("tcc: cannot build the shim");
			return shim;
		},
		exit: (code) => {
			exits.push(code);
		},
		closeWindow: (hwnd) => {
			open.delete(hwnd);
		},
	};
}
