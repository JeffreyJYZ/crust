/**
 * The fake's surface half — the table, the create/close path and the handle-keyed calls — split from
 * `fake-shim.ts` when that table passed the line cap, along the same seam `backend-webview.ts` splits
 * the real interface. The environment, thread, object and handler numbers live in
 * `fake-webview-probe.ts`, because none of them reads the table.
 *
 * The surface table is modelled here because the real one is what a second webview stops being a
 * singleton on: a handle is an index into `hwndOf`, 0 for the first window, exactly as
 * `41_surfaces.c` numbers them. The C table itself is executed by `surfaces.test.ts`; this fake is for
 * the platform path, so it records calls rather than proving the table.
 */
import type { WindowsShim } from "./backend.ts";
import type { FakeOptions } from "./fake-backend.ts";
import { text } from "./fake-bytes.ts";
import { type FakeWebViewProbeShim, fakeWebViewProbe } from "./fake-webview-probe.ts";

export type FakeWebViewShim = Pick<
	WindowsShim,
	| "shim_webview_new"
	| "shim_webview_put_bounds"
	| "shim_webview_close"
	| "shim_webview_live"
	| "shim_webview_index"
	| "shim_webview_set_bounds"
	| "shim_webview_bound"
	| "shim_navigate_hresult"
	| "shim_webview_source"
	| "shim_webview_navigate_string"
	| "shim_webview_navigate"
	| "shim_webview_vtbl"
	| "shim_webview_slot"
	| "shim_webview_handle"
	| "shim_attach_hresult"
	| "shim_webview_bind"
	| "shim_webview_size"
	| "shim_webview_attach"
> &
	FakeWebViewProbeShim;

export function fakeWebView(calls: string[], options: FakeOptions = {}): FakeWebViewShim {
	// The table `41_surfaces.c` holds, in the same shape: `hwnd` per handle (0 = free), and one
	// rectangle and one Navigate HRESULT per handle. Entry 0 is the first window, as it is in C.
	const hwndOf: number[] = [];
	const bounds: [number, number, number, number][] = [];
	const navigateHr: number[] = [];
	const find = (hwnd: number): number => hwndOf.indexOf(hwnd);
	/** `shim_surface_has`: a live handle, never a hole or an index past the table. */
	const live = (handle: number): boolean => handle >= 0 && (hwndOf[handle] ?? 0) !== 0;
	const reserve = (hwnd: number): number => {
		const existing = find(hwnd);
		if (existing >= 0) return existing;
		const free = hwndOf.indexOf(0);
		const handle = free < 0 ? hwndOf.length : free;
		hwndOf[handle] = hwnd;
		bounds[handle] = [0, 0, 0, 0];
		navigateHr[handle] = 0;
		return handle;
	};

	return {
		shim_webview_new: (hwnd, url) => {
			calls.push(`webview_new:${text(url)}`);
			if (options.failWebView) return 0;
			reserve(Number(hwnd));
			return 1;
		},
		shim_webview_put_bounds: (hwnd, width, height) => {
			calls.push(`bounds:${Number(width)}x${Number(height)}`);
			const handle = find(Number(hwnd));
			if (live(handle)) bounds[handle]?.splice(0, 4, 0, 0, width, height);
			return 1;
		},
		shim_webview_close: (hwnd) => {
			calls.push("webview_close");
			const handle = find(Number(hwnd));
			if (handle >= 0) hwndOf[handle] = 0;
		},
		shim_webview_live: () => hwndOf.reduce((count, hwnd) => count + (hwnd ? 1 : 0), 0),
		shim_webview_index: (hwnd) => find(Number(hwnd)),
		shim_webview_set_bounds: (handle, x, y, width, height) => {
			calls.push(`set_bounds:${Number(handle)}:${Number(width)}x${Number(height)}`);
			if (!live(Number(handle))) return 0;
			bounds[Number(handle)]?.splice(0, 4, x, y, width, height);
			return 1;
		},
		shim_webview_bound: (handle, which) => bounds[Number(handle)]?.[Number(which)] ?? 0,
		shim_navigate_hresult: (handle) => navigateHr[Number(handle)] ?? 0,
		shim_webview_source: (handle) => (live(Number(handle)) ? 0 : -2147467259),
		shim_webview_navigate_string: (handle) => (live(Number(handle)) ? 1 : 0),
		shim_webview_navigate: (handle, url) => {
			calls.push(`webview_navigate:${Number(handle)}:${text(url)}`);
			if (!live(Number(handle))) return 0;
			navigateHr[Number(handle)] = options.failWebView ? -2147467259 : 0;
			return options.failWebView ? 0 : 1;
		},
		shim_webview_vtbl: (handle) => (live(Number(handle)) ? 0x6000 : 0),
		shim_webview_slot: (handle) => (live(Number(handle)) ? 0x7000 : 0),
		shim_webview_handle: (handle) => (live(Number(handle)) ? 0x5000 + Number(handle) : 0),
		shim_attach_hresult: () => 0,
		shim_webview_bind: (hwnd) => {
			calls.push("webview_bind");
			if (options.failWebView) return 0;
			reserve(Number(hwnd));
			return 1;
		},
		shim_webview_size: () => {
			calls.push("webview_size");
			return options.failWebView ? 0 : 1;
		},
		shim_webview_attach: () => {
			calls.push("webview_attach");
			return options.failWebView ? 0 : 1;
		},

		// The numbers: environment, thread, apartment, object and handler readbacks.
		...fakeWebViewProbe(calls, options),
	};
}
