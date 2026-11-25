/**
 * The platform calls the Linux browser adapter makes, injectable so a unit test never loads GTK.
 *
 * A surface is an ordinary `WebKitWebView` for which the platform owns no window: it is placed into
 * the host window's overlay container at the caller's rectangle, so `open` is create/place/load and a
 * move is the same `place` call again. `activeLinuxPlatform()` is where the host window and the symbol
 * table come from, the same registration the window adapter uses.
 */
import { CrustError } from "@/bridge/errors";
import type { BrowserBounds, BrowserState } from "@/plugins/browser";
import { activeLinuxPlatform } from "./active-platform.ts";
import { cstring } from "./cstring.ts";
import { linuxOpenerAdapter } from "./opener.ts";
import { type LinuxShim, shim } from "./shim-ffi.ts";

/** A host window: its own view, and the container a surface is placed in. */
export interface BrowserOwner {
	label: string;
	win: bigint;
	box: bigint;
}

export interface LinuxBrowserPorts {
	shim(): LinuxShim;
	owner(label?: string): BrowserOwner | undefined;
	windowOpen(label: string): boolean;
	newView(): bigint;
	place(box: bigint, web: bigint, bounds: BrowserBounds): boolean;
	load(web: bigint, url: string): boolean;
	watch(web: bigint): boolean;
	denyCapture(web: bigint): boolean;
	/** Connect `decide-policy` so every committed navigation reaches the gate. */
	watchNav(web: bigint): boolean;
	/** The same load call, by address: a navigation is not a new view. */
	navigate(web: bigint, url: string): boolean;
	state(web: bigint): BrowserState;
	close(web: bigint): void;
	sink(pointer: number): void;
	decisionSink(pointer: number): void;
	popupUrl(): string;
	/** The decided navigation's URI, read from a buffer separate from the popup one. */
	decisionUrl(): string;
	opener(url: string): { status: number; reason: string };
}

/** GTK takes points as ints; a non-finite bound is a caller bug, not a rectangle. */
function points(bounds: BrowserBounds): [number, number, number, number] {
	const values: [number, number, number, number] = [
		Math.round(bounds.x),
		Math.round(bounds.y),
		Math.round(bounds.width),
		Math.round(bounds.height),
	];
	if (!values.every(Number.isFinite)) throw new Error("browser: bounds must be finite numbers");
	return values;
}

export function realPorts(): LinuxBrowserPorts {
	let live: LinuxShim | undefined;
	const symbols = (): LinuxShim => {
		live ??= activeLinuxPlatform()?.native ?? shim().symbols;
		return live;
	};
	const opener = linuxOpenerAdapter(symbols);
	const readUrl = (read: ((buffer: Uint8Array, cap: number) => number) | undefined): string => {
		if (!read) return "";
		const buffer = new Uint8Array(2048);
		const length = Number(read(buffer, buffer.length) ?? 0);
		if (length <= 0) return "";
		return new TextDecoder().decode(buffer.subarray(0, Math.min(length, buffer.length - 1)));
	};

	return {
		shim: symbols,
		owner: (label) => {
			const platform = activeLinuxPlatform()?.platform;
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
			const native = platform.nativeWindow(chosen);
			return native === undefined
				? undefined
				: { label: chosen, win: native.win, box: native.box };
		},
		windowOpen: (label) =>
			activeLinuxPlatform()?.platform.windowLabels().includes(label) ?? false,
		newView: () => BigInt(Number(symbols().shim_webview_new() ?? 0)),
		place: (box, web, bounds) => {
			const [x, y, width, height] = points(bounds);
			return Number(symbols().shim_webview_place?.(box, web, x, y, width, height) ?? 0) === 1;
		},
		load: (web, url) => Number(symbols().shim_webview_load(web, cstring(url)) ?? 0) === 1,
		watch: (web) => Number(symbols().shim_browser_watch_popups?.(web) ?? 0) === 1,
		denyCapture: (web) => Number(symbols().shim_browser_deny_capture?.(web) ?? 0) === 1,
		watchNav: (web) => Number(symbols().shim_browser_watch_nav?.(web) ?? 0) === 1,
		navigate: (web, url) => Number(symbols().shim_webview_load(web, cstring(url)) ?? 0) === 1,
		state: (web) => ({
			url: String(symbols().shim_webview_uri?.(web) ?? ""),
			title: String(symbols().shim_webview_title?.(web) ?? ""),
			loading: Number(symbols().shim_webview_is_loading?.(web) ?? 0) === 1,
			canGoBack: Number(symbols().shim_webview_can_back?.(web) ?? 0) === 1,
			canGoForward: Number(symbols().shim_webview_can_forward?.(web) ?? 0) === 1,
		}),
		close: (web) => {
			symbols().shim_webview_close?.(web);
		},
		sink: (pointer) => {
			symbols().shim_browser_set_sink?.(pointer);
		},
		decisionSink: (pointer) => {
			symbols().shim_browser_set_decision_sink?.(pointer);
		},
		popupUrl: () => readUrl(symbols().shim_browser_popup_url),
		decisionUrl: () => readUrl(symbols().shim_browser_navigation_url),
		opener: (url) => {
			const outcome = opener.openUrl(url);
			// `external` is a synchronous answer by contract; a promise here would be a page asking
			// before the desktop had decided, so it is refused rather than awaited into nothing.
			if (outcome instanceof Promise)
				throw new Error("browser: the opener answered asynchronously");
			return { status: outcome.status, reason: outcome.reason };
		},
	};
}
