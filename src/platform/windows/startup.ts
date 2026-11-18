/**
 * The Windows startup sequence, split from `platform.ts` when that file reached the line cap: probe
 * the machine, compile the shim, bring up COM and the window class.
 *
 * Each failure is a *message*, not a throw, because a machine without the WebView2 runtime is a
 * supported state — `start()` resolves and reports, and `createWindow` throws the same text, so an
 * app can print the install remedy instead of dying in a stack trace nobody can act on. The strings
 * are pinned by `platform.test.ts`, so they move only with the test.
 */
import type { WindowsBackend, WindowsShim } from "./backend.ts";
import { cstring } from "./cstring.ts";
import { hresult } from "./platform-config.ts";
import { preflightError } from "./preflight.ts";

/** The compiled shim, or the one line that says why this machine cannot open a window. */
export type WindowsStartup =
	| { readonly ok: true; readonly shim: WindowsShim }
	| { readonly ok: false; readonly unavailable: string };

export function startWindows(backend: WindowsBackend, appName: string): WindowsStartup {
	const missing = preflightError(backend.probe());
	if (missing) return { ok: false, unavailable: missing };
	const shim = backend.load();
	// Every Win32 entry point is a pointer `12_win32.c` resolves at runtime, so a machine that is
	// missing one is a message here rather than a null call at the first window.
	if (!Number(shim.shim_win32_ready())) {
		return {
			ok: false,
			unavailable:
				"crust: the Win32 entry points did not resolve — user32, ole32 or kernel32 is missing an export this shim calls",
		};
	}
	const hr = Number(shim.shim_com_init());
	// S_OK (0) and S_FALSE (1) both mean the apartment is usable; anything else is a machine that
	// cannot host COM, where a window would fail later with no cause attached.
	if (hr < 0) {
		return {
			ok: false,
			unavailable: `crust: CoInitializeEx failed (${hresult(hr)}) — WebView2 needs a single-threaded apartment`,
		};
	}
	if (!Number(shim.shim_register_class(cstring(appName)))) {
		return {
			ok: false,
			unavailable: `crust: RegisterClassExW("${appName}") failed (GetLastError ${Number(shim.shim_last_error())})`,
		};
	}
	return { ok: true, shim };
}
