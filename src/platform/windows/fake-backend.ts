/**
 * A `WindowsBackend` that records calls instead of reaching Windows. Every test in this directory
 * uses it: no Win32 symbol can run on the machine this suite runs on, and an injected fake is the
 * only way the five `Platform` methods are testable at all.
 */
import type { WindowsBackend } from "./backend.ts";
import type { WindowsRuntimeReport } from "./preflight.ts";
import { fakeShim } from "./fake-shim.ts";

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
	/** HRESULT `shim_window_set_material` answers; negative is a refused backdrop. */
	materialResult?: number;
	/** Return 0 from `shim_window_set_frame`, as a refused `SetWindowPos` does. */
	failFrame?: boolean;
	/** Return 0 from `shim_window_focus`, as Windows' foreground lock does. */
	failFocus?: boolean;
	/** What `shim_window_is_minimized` answers. */
	minimized?: boolean;
	/** What `shim_window_is_maximized` answers. */
	maximized?: boolean;
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
