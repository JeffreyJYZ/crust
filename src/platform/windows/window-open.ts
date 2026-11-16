/**
 * Build one Win32 window and its WebView2 controller. Kept out of `platform.ts` so the class stays
 * the lifecycle: this module owns the creation order, the URL resolution and every failure text a
 * caller reads. Both `cstring` arguments are NUL-terminated buffers — bun:ffi throws on a
 * JavaScript string at that argument before C runs.
 */
import type { WindowOptions } from "@/app.ts";
import type { WindowsShim } from "./backend.ts";
import { cstring } from "./cstring.ts";
import { DEFAULT_HEIGHT, DEFAULT_WIDTH, absoluteUrl } from "./platform-config.ts";

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
		shim.shim_window_destroy(hwnd);
		// 126 is ERROR_MOD_NOT_FOUND: the shim's LoadLibraryW("WebView2Loader.dll") did not find the
		// loader. Otherwise the reason is in the two HRESULTs: the controller call's own, and the one
		// its completion handler carried — a refused call and a callback that never came differ only
		// there, and the composite that failed answers 0/1.
		const error = Number(shim.shim_last_error());
		const begin = Number(shim.shim_controller_hresult());
		const callback = Number(shim.shim_controller_callback());
		const environment = Number(shim.shim_env_callback());
		throw new Error(
			`WebView2 controller failed for "${label}" (GetLastError ${error}, ` +
				`CreateCoreWebView2Controller 0x${(begin >>> 0).toString(16)}, ` +
				`controller callback 0x${(callback >>> 0).toString(16)}, ` +
				`environment callback 0x${(environment >>> 0).toString(16)}) — ` +
				(error === 126
					? "WebView2Loader.dll did not load; it must sit beside the executable or on PATH"
					: "the runtime is installed but did not answer"),
		);
	}
	return { hwnd, url };
}
