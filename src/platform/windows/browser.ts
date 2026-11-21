/**
 * The Windows half of `crust:browser`: a second WebView2 controller, in a child window of the app's
 * own window, over the app's page and sized by the caller.
 *
 * Three things decide this module's shape.
 * - **A child window, not a second webview in one.** `CreateCoreWebView2Controller` takes an HWND, so
 *   the overlay is a child of the app window at the caller's rectangle and the controller belongs to
 *   it. Moving the surface is `SetWindowPos`, and the class's WM_SIZE handler resizes the controller
 *   — the same path that keeps the app's own page full-window.
 * - **Its own handles.** `41_surfaces.c` keys every call by index, 0 being the app's own webview, so
 *   a surface is addressable without a second window and a close frees only its own slot.
 * - **A refused new window is reported, never opened.** WebView2's NewWindowRequested handler sets
 *   `Handled`, so no popup window appears, and the URL reaches the plugin's origin gate through the
 *   same sink darwin's `WKUIDelegate` uses.
 *
 * There is no picture: WebView2's `CapturePreview` needs an `IStream` implementation this layer does
 * not have, so `capture` answers `not-implemented` naming it rather than a screenshot of the screen.
 */
import { FFIType, JSCallback } from "bun:ffi";
import type {
	BrowserAdapter,
	BrowserBounds,
	BrowserCapture,
	BrowserFailure,
	BrowserOpenInput,
	BrowserState,
} from "@/plugins/browser";
import { asFailure } from "@/plugins/browser-failures";
import { type Surface, SurfaceStore } from "@/plugins/browser-surfaces";
import { type NotImplemented, notImplemented } from "@/plugins/define";
import { realPorts, type WindowsBrowserPorts } from "./browser-ports";

export type { WindowsBrowserPorts } from "./browser-ports";

/** What one surface is on this platform: its handle in the table, and the child window holding it. */
export interface WindowsSurface {
	handle: number;
	child: number;
}

const I32 = FFIType.i32;
const P = FFIType.ptr;
const V = FFIType.void;

/** One callback for the process: C keeps a single function pointer. */
let sink: JSCallback | undefined;

function callbackPointer(callback: JSCallback): number {
	const raw: unknown = callback.ptr;
	const value = typeof raw === "number" ? raw : typeof raw === "bigint" ? Number(raw) : 0;
	if (value === 0) throw new Error("crust: JSCallback exposed no usable pointer");
	return value;
}

export function windowsBrowserAdapter(ports?: WindowsBrowserPorts): BrowserAdapter {
	const store = new SurfaceStore<WindowsSurface>();
	let live: WindowsBrowserPorts | undefined = ports;
	const port = (): WindowsBrowserPorts => (live ??= realPorts());

	/** Report a refused new window to the surface that asked, and to nobody else. */
	const channel = (): void => {
		if (sink !== undefined) return;
		sink = new JSCallback(
			(_count: number, web: number) => {
				const surface = store
					.values()
					.find((entry) => port().webPointer(entry.web.handle) === Number(web));
				if (surface === undefined) return 0;
				try {
					surface.onPopup?.(port().popupUrl());
				} catch {
					// A page listener that throws must not unwind into WebView2's callback.
				}
				return 0;
			},
			{ args: [I32, P], returns: V },
		);
		port().sink(callbackPointer(sink));
	};

	return {
		open(input: BrowserOpenInput): { ok: true; label: string } | BrowserFailure {
			if (store.has(input.label)) {
				return {
					ok: false,
					code: "bad-request",
					message: `browser.open: a surface called ${JSON.stringify(input.label)} is already open`,
				};
			}
			try {
				const p = port();
				const owner = p.owner(input.owner);
				if (owner === undefined)
					return asFailure(new Error("browser.open: no open window to host the surface"));
				const child = p.child(owner.hwnd, input.bounds);
				if (child === 0)
					return asFailure(new Error("browser.open: Win32 refused the child window"));
				const handle = p.surface(child, input.url);
				if (handle <= 0) {
					p.release(child);
					return asFailure(
						new Error(`browser.open: the surface could not load ${input.url}`),
					);
				}
				// Both subscriptions are required: without them `state.loading` never clears, and a
				// `target=_blank` would become a window WebView2 owns rather than an opener hand-off.
				if (!p.watch(handle)) {
					p.release(child);
					return asFailure(
						new Error("browser.open: WebView2 refused the navigation handlers"),
					);
				}
				if (!p.refusePopups(handle)) {
					p.release(child);
					return asFailure(
						new Error("browser.open: WebView2 refused the new-window handler"),
					);
				}
				channel();
				store.set({
					label: input.label,
					web: { handle, child },
					owner: owner.label,
					onPopup: input.onPopup,
				});
				return { ok: true, label: input.label };
			} catch (error) {
				return asFailure(error);
			}
		},
		navigate(label: string, url: string): { ok: true; loaded: boolean } | BrowserFailure {
			const surface = store.mine(label, releasePort(port()));
			if ("ok" in surface) return surface;
			try {
				return {
					ok: true,
					loaded: port().navigate(surface.web.handle, url),
				};
			} catch (error) {
				return asFailure(error);
			}
		},
		state(label: string): (BrowserState & { ok: true }) | BrowserFailure | null {
			const surface = store.mine(label, releasePort(port()));
			if ("ok" in surface) return surface;
			try {
				return { ok: true, ...port().state(surface.web.handle) };
			} catch (error) {
				return asFailure(error);
			}
		},
		setBounds(label: string, bounds: BrowserBounds): { ok: true } | BrowserFailure {
			const surface = store.mine(label, releasePort(port()));
			if ("ok" in surface) return surface;
			try {
				// WM_SIZE resizes the controller to the new client area, so one call moves both.
				if (port().move(surface.web.child, bounds) !== 1) {
					return asFailure(new Error("browser.setBounds: Win32 refused the move"));
				}
				return { ok: true };
			} catch (error) {
				return asFailure(error);
			}
		},
		close(label: string): { ok: true; closed: true } | BrowserFailure {
			return store.close(label, releasePort(port()));
		},
		async capture(
			label: string,
		): Promise<(BrowserCapture & { ok: true }) | BrowserFailure | NotImplemented> {
			const surface = store.mine(label, releasePort(port()));
			if ("ok" in surface) return surface;
			return notImplemented(
				"browser.capture needs the surface's own render, and WebView2's CapturePreview wants an " +
					"IStream this layer does not implement",
				"ICoreWebView2::CapturePreview",
			);
		},
		external(url: string): { opened: boolean; reason?: string } {
			try {
				const outcome = port().opener(url);
				return outcome.status === 0
					? { opened: true }
					: { opened: false, reason: outcome.reason };
			} catch (error) {
				return { opened: false, reason: asFailure(error).message };
			}
		},
	};
}

/** The store's teardown, as a value so both `mine` and `close` share one release path. */
function releasePort(ports: WindowsBrowserPorts) {
	return {
		windowOpen: (label: string) => ports.windowOpen(label),
		release: (surface: Surface<WindowsSurface>) => {
			ports.release(surface.web.child);
		},
	};
}
