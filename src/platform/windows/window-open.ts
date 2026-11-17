/**
 * Build one Win32 window and its WebView2 controller. Kept out of `platform.ts` so the class stays
 * the lifecycle: this module owns the creation order, the URL resolution and every failure text a
 * caller reads. Both `cstring` arguments are NUL-terminated buffers — bun:ffi throws on a
 * JavaScript string at that argument before C runs.
 */
import type { WindowOptions } from "@/app.ts";
import type { WindowsShim } from "./backend.ts";
import { cstring } from "./cstring.ts";
import { DEFAULT_HEIGHT, DEFAULT_WIDTH, absoluteUrl, objectStateName } from "./platform-config.ts";

export interface OpenedWindow {
	hwnd: number;
	/** The absolute URL the controller was told to navigate to. */
	url: string;
}

/** Create the window, then the controller, then navigate. Throws with the OS error on failure. */
export function openWindow(
	shim: WindowsShim,
	options: WindowOptions,
	appName: string,
	userDataDir: string,
): OpenedWindow {
	const label = options.label;
	const width = options.width ?? DEFAULT_WIDTH;
	const height = options.height ?? DEFAULT_HEIGHT;
	const hwnd = Number(
		shim.shim_window_new(cstring(options.title ?? label), width, height, cstring(appName)),
	);
	if (!hwnd) {
		throw new Error(
			`CreateWindowExW failed for "${label}" (GetLastError ${Number(shim.shim_last_error())})`,
		);
	}
	const url = absoluteUrl(options.url ?? "/");
	if (!Number(shim.shim_webview_new(hwnd, cstring(url), cstring(userDataDir)))) {
		// The bind inside shim_webview_new runs before Navigate, so a Navigate failure leaves a
		// controller recorded in the shim's slot table. Close it first: only close clears that slot
		// and releases the controller; destroy alone leaks both and bricks window creation after
		// eight retries. A failure before bind makes close a no-op, so the order is always safe.
		shim.shim_webview_close(hwnd);
		shim.shim_window_destroy(hwnd);
		// 126 is ERROR_MOD_NOT_FOUND: LoadLibraryW("WebView2Loader.dll") did not find the loader.
		// Anything else is named by the HRESULTs and by what the controller pointer turned out to be:
		// the runner's CreateCoreWebView2Controller and its callback both returned S_OK while the object
		// they produced had no readable vtable, so blaming the runtime would send the next person wrong.
		const error = Number(shim.shim_last_error());
		const begin = Number(shim.shim_controller_hresult());
		const callback = Number(shim.shim_controller_callback());
		const environment = Number(shim.shim_env_callback());
		const state = Number(shim.shim_object_state(shim.shim_controller_addr()));
		const hex = (value: number): string => `0x${(value >>> 0).toString(16)}`;
		const reason =
			error === 126
				? "WebView2Loader.dll did not load; it must sit beside the executable or on PATH"
				: state === 1
					? "the controller pointer is unreadable, so it never named an ICoreWebView2Controller"
					: state === 2
						? "the controller has no readable vtable, so it is not an ICoreWebView2Controller yet"
						: `a vtable entry was refused (bad slot ${Number(shim.shim_bad_slot())})`;
		throw new Error(
			`WebView2 controller failed for "${label}" (GetLastError ${error}, ` +
				`CreateCoreWebView2Controller ${hex(begin)}, ` +
				`controller callback ${hex(callback)}, ` +
				`environment callback ${hex(environment)}, ` +
				`object ${objectStateName(state)}, ctrl_from ${Number(shim.shim_ctrl_from())}) — ${reason}`,
		);
	}
	return { hwnd, url };
}
