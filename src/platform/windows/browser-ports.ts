/**
 * The platform calls the Windows browser adapter makes, injectable so a unit test never compiles C or
 * sends WebView2 a COM call. The real set is built on first use, the same laziness `darwinBrowserAdapter`
 * relies on: merely importing the plugin costs nothing.
 *
 * A surface is a child HWND of the app's window with its own controller, so `open` is three calls
 * (child window, controller, handle) and everything after it addresses the handle `41_surfaces.c`
 * hands out — 0 is the app's own webview, 1 the first surface, and so on.
 */
import { CrustError } from "@/bridge/errors";
import type { BrowserBounds, BrowserState } from "@/plugins/browser";
import { activeWindowsPlatform } from "./active-platform.ts";
import type { WindowsShim } from "./backend.ts";
import { windowsOpenerAdapter } from "./opener.ts";

/** A window and the label it was chosen by, so a surface can watch that window later. */
export interface BrowserOwner {
	label: string;
	hwnd: number;
}

/** The text buffer every state read fills; a page title past this is truncated, not refused. */
const TEXT_MAX = 2048;

export interface WindowsBrowserPorts {
	shim(): WindowsShim;
	owner(label?: string): BrowserOwner | undefined;
	windowOpen(label: string): boolean;
	/** The child window one surface lives in. */
	child(parent: number, bounds: BrowserBounds): number;
	move(child: number, bounds: BrowserBounds): number;
	/** The whole surface: composite, both policies, first load. -1 when WebView2 refused it. */
	surface(child: number, url: string): number;
	/** Point one surface at another allowlisted URL, in place. */
	navigate(handle: number, url: string): boolean;
	/** The `ICoreWebView2` the handle names, so a popup event can be matched to its surface. */
	webPointer(handle: number): number;
	watch(handle: number): boolean;
	refusePopups(handle: number): boolean;
	state(handle: number): BrowserState;
	opener(url: string): { status: number; reason: string };
	sink(pointer: number): void;
	popupUrl(): string;
	/** Tear one surface down: the child window goes, and WM_DESTROY releases the handle. */
	release(child: number): void;
}

function text(read: (dst: Uint8Array) => number): string {
	const buffer = new Uint8Array(TEXT_MAX);
	const length = Number(read(buffer));
	if (length <= 0) return "";
	return new TextDecoder().decode(buffer.subarray(0, Math.min(length, buffer.length - 1)));
}

export function realPorts(): WindowsBrowserPorts {
	let live: WindowsShim | undefined;
	const shim = (): WindowsShim => {
		live ??= activeWindowsPlatform()?.shim();
		if (live === undefined) {
			throw new CrustError(
				"bad-request",
				"browser.open: no Windows platform has started, so there is no window to host a surface",
			);
		}
		return live;
	};
	const opener = windowsOpenerAdapter(shim);

	return {
		shim,
		owner: (label) => {
			const platform = activeWindowsPlatform();
			if (platform === undefined) return undefined;
			const labels = platform.windowLabels();
			const chosen = label ?? labels[0];
			if (chosen === undefined) {
				throw new CrustError(
					"bad-request",
					"browser.open: there is no open window to host a surface",
				);
			}
			if (!labels.includes(chosen)) {
				throw new CrustError(
					"bad-request",
					`crust: there is no open window ${JSON.stringify(chosen)}; open windows: ${JSON.stringify(labels)}`,
				);
			}
			const hwnd = platform.nativeWindow(chosen) ?? 0;
			return hwnd === 0 ? undefined : { label: chosen, hwnd };
		},
		windowOpen: (label) => activeWindowsPlatform()?.windowLabels().includes(label) ?? false,
		child: (parent, bounds) =>
			Number(
				shim().shim_child_new(
					parent,
					Math.round(bounds.x),
					Math.round(bounds.y),
					Math.round(bounds.width),
					Math.round(bounds.height),
				) ?? 0,
			),
		move: (child, bounds) =>
			Number(
				shim().shim_child_move(
					child,
					Math.round(bounds.x),
					Math.round(bounds.y),
					Math.round(bounds.width),
					Math.round(bounds.height),
				) ?? 0,
			),
		// The composite installs both policy handlers **before** the first load, so a fast
		// NavigationCompleted cannot land on a surface whose `loading` flag nobody will clear.
		surface: (child, url) =>
			Number(
				shim().shim_browser_surface_new(
					child,
					Buffer.from(`${url}\0`),
					Buffer.from("\0"),
				) ?? 0,
			),
		watch: (handle) => Number(shim().shim_webview_watch(handle) ?? 0) === 1,
		refusePopups: (handle) => Number(shim().shim_webview_refuse_popups(handle) ?? 0) === 1,
		navigate: (handle, url) =>
			Number(shim().shim_webview_navigate(handle, Buffer.from(`${url}\0`)) ?? 0) === 1,
		webPointer: (handle) => Number(shim().shim_webview_handle(handle) ?? 0),
		state: (handle) => ({
			url: text((dst) => shim().shim_webview_url_text(handle, dst, dst.length)),
			title: text((dst) => shim().shim_webview_title_text(handle, dst, dst.length)),
			loading: Number(shim().shim_webview_loading(handle) ?? 0) === 1,
			canGoBack: Number(shim().shim_webview_can_go_back(handle) ?? 0) === 1,
			canGoForward: Number(shim().shim_webview_can_go_forward(handle) ?? 0) === 1,
		}),
		opener: (url) => {
			const outcome = opener.openUrl(url);
			// `external` answers synchronously by contract: a promise here would mean the desktop had
			// not decided yet, and waiting is not a shape the plugin has.
			if (outcome instanceof Promise)
				throw new Error("browser: the opener answered asynchronously");
			return { status: outcome.status, reason: outcome.reason };
		},
		sink: (pointer) => {
			shim().shim_browser_set_sink(pointer);
		},
		popupUrl: () => text((dst) => shim().shim_browser_popup_url(dst, dst.length)),
		release: (child) => {
			shim().shim_window_destroy(child);
		},
	};
}
