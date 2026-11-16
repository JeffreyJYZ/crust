/**
 * The macOS half of `crust:navigation`: the event channel and the adapter.
 * `WKNavigationDelegate` is built at runtime by `shim/107_navigation.c` with
 * `objc_allocateClassPair` + `class_addMethod`, and kept alive with
 * `objc_setAssociatedObject` — `-navigationDelegate` is unretained, so without that
 * association the delegate is freed under WebKit.
 * Four callbacks reach JavaScript through one `JSCallback`, the only callback form that may
 * cross `bun:ffi`: a block may not, and what it carries is a scalar pair (kind, webview). The
 * URL, the title and the failure's message are read back through their own exports in
 * `navigation-unit.ts`, so no object ever crosses.
 */

import { JSCallback, FFIType } from "bun:ffi";
import type {
	NavigationAdapter,
	NavigationEventKind,
	NavigationEventPayload,
	NavigationInstall,
	NavigationState,
} from "@/plugins/navigation";
import {
	NAVIGATION_STATUS,
	darwinNavigationWebview,
	navigationInstallReason,
	navigationUnit,
	unitText,
	webviewText,
	type NavigationNative,
} from "./navigation-unit";
import type { WebviewFor, LabeledAdapter } from "./webview-target.ts";

export { NAVIGATION_STATUS, darwinNavigationWebview, navigationInstallReason, navigationUnit };
export type { NavigationNative, NavigationUnit } from "./navigation-unit";

const P = FFIType.ptr;
const I32 = FFIType.i32;

/** `NAV_START`…`NAV_FAIL` in the C unit, as the event names the plugin emits. */
const KINDS: Record<number, NavigationEventKind> = {
	1: "did-start",
	2: "did-commit",
	3: "did-finish",
	4: "did-fail",
};

type Listener = (kind: NavigationEventKind, payload: NavigationEventPayload) => void;

/** One sink per process: C keeps a single function pointer, so a second JSCallback is never reached. */
let sink: JSCallback | undefined;
const listeners = new Map<number, Listener>();

function callbackPointer(callback: JSCallback): number {
	const raw: unknown = callback.ptr;
	const value = typeof raw === "number" ? raw : typeof raw === "bigint" ? Number(raw) : 0;
	if (value === 0) throw new Error("crust: JSCallback exposed no usable pointer");
	return value;
}

/** What a callback reports: the page's address and title, plus the failure's message. */
function payloadOf(native: NavigationNative, view: number): NavigationEventPayload {
	const payload: NavigationEventPayload = {
		url: webviewText(native.crust_nav_url, view),
		title: webviewText(native.crust_nav_title, view),
	};
	const message = unitText(native.crust_nav_error);
	if (message.length > 0) payload.message = message;
	return payload;
}

function channel(native: NavigationNative): void {
	if (sink === undefined) {
		sink = new JSCallback(
			(kind: number, web: number) => {
				const event = KINDS[Number(kind)];
				const view = Number(web);
				const listener = listeners.get(view);
				if (event === undefined || listener === undefined) return 0;
				try {
					listener(event, payloadOf(native, view));
				} catch {
					// An exception crossing back into AppKit aborts the process.
				}
				return 0;
			},
			{ args: [I32, P], returns: I32 },
		);
	}
	native.crust_nav_set_sink(callbackPointer(sink));
}

/**
 * Build the adapter. `web` resolves a window label to the WKWebView pointer, per call, because
 * a window created after this ran still has to be reachable and a multi-window app must reach
 * the window a command names. No label is the app's first open window; an unknown label is the
 * resolver's `bad-request`, never a silent fall back to that first window.
 */
export function darwinNavigationAdapter(
	web: WebviewFor,
	native: NavigationNative = navigationUnit().symbols,
): LabeledAdapter<NavigationAdapter> {
	const target = (label?: string): number | null => {
		const pointer = web(label);
		return pointer === null || pointer === 0 ? null : pointer;
	};
	/** A command with no webview moved nothing, which is the truth rather than an error. */
	const act = (call: (view: number) => number, label?: string): boolean => {
		const view = target(label);
		return view === null ? false : Number(call(view) ?? 0) === 1;
	};

	return {
		start(listener: Listener, label?: string): NavigationInstall {
			const view = target(label);
			if (view === null) {
				return {
					ok: false,
					status: NAVIGATION_STATUS.missing,
					reason: "there is no WKWebView yet; install after the window exists",
				};
			}
			channel(native);
			listeners.set(view, listener);
			const status = Number(native.crust_nav_install(view) ?? NAVIGATION_STATUS.missing);
			if (status !== NAVIGATION_STATUS.installed) listeners.delete(view);
			return {
				ok: status === NAVIGATION_STATUS.installed,
				status,
				reason: navigationInstallReason(status),
			};
		},
		stop: (label?: string) => {
			const view = target(label);
			if (view === null) return;
			listeners.delete(view);
			native.crust_nav_uninstall(view);
		},
		state: (label?: string): NavigationState | null => {
			const view = target(label);
			if (view === null) return null;
			return {
				url: webviewText(native.crust_nav_url, view),
				title: webviewText(native.crust_nav_title, view),
				loading: Number(native.crust_nav_loading(view) ?? 0) === 1,
				canGoBack: Number(native.crust_nav_can_go_back(view) ?? 0) === 1,
				canGoForward: Number(native.crust_nav_can_go_forward(view) ?? 0) === 1,
			};
		},
		reload: (label?: string) => act(native.crust_nav_reload, label),
		goBack: (label?: string) => act(native.crust_nav_go_back, label),
		goForward: (label?: string) => act(native.crust_nav_go_forward, label),
	};
}
