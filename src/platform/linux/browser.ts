/**
 * The Linux half of `crust:browser`: a second `WebKitWebView` placed over the app's page inside the
 * host window's overlay container, at the rectangle the caller reserved.
 *
 * Three things decide this module's shape.
 * - **The container is the window's, not the surface's.** `41_container.c` gives every window one
 *   `GtkOverlay`, whose main child is the app's own page; a surface is an overlay child, so a resize
 *   and a move are the same `place` call and the app's page keeps filling the window.
 * - **The two policies are signals.** `create` refuses a new view and reports its URL, and
 *   `permission-request` denies capture — the same two rules darwin installs in a `WKUIDelegate`.
 * - **Its own view means its own state.** The per-view records in `32_view_state.c` are keyed by the
 *   handle, so `state` answers for this surface while the app's page loads beside it.
 *
 * There is no picture: WebKitGTK's `get_snapshot` answers a cairo surface this layer cannot encode,
 * so `capture` names the call it is missing rather than screenshotting the screen.
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
import { type LinuxBrowserPorts, realPorts } from "./browser-ports";

export type { LinuxBrowserPorts } from "./browser-ports";

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

export function linuxBrowserAdapter(ports?: LinuxBrowserPorts): BrowserAdapter {
	const store = new SurfaceStore<bigint>();
	let live: LinuxBrowserPorts | undefined = ports;
	const port = (): LinuxBrowserPorts => (live ??= realPorts());

	/** Report a refused new window to the surface that asked, and to nobody else. */
	const channel = (): void => {
		if (sink !== undefined) return;
		sink = new JSCallback(
			(_count: number, web: number) => {
				const surface = store.values().find((entry) => Number(entry.web) === Number(web));
				if (surface === undefined) return 0;
				try {
					surface.onPopup?.(port().popupUrl());
				} catch {
					// A page listener that throws must not unwind into GTK's signal emission.
				}
				return 0;
			},
			{ args: [I32, P], returns: V },
		);
		port().sink(callbackPointer(sink));
	};

	const release = {
		windowOpen: (label: string) => port().windowOpen(label),
		release: (surface: Surface<bigint>) => {
			port().close(surface.web);
		},
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
				const web = p.newView();
				if (web === 0n)
					return asFailure(new Error("browser.open: WebKit refused a new view"));
				if (!p.place(owner.box, web, input.bounds)) {
					p.close(web);
					return asFailure(
						new Error("browser.open: the container refused the rectangle"),
					);
				}
				if (!p.load(web, input.url)) {
					p.close(web);
					return asFailure(
						new Error(`browser.open: the surface could not load ${input.url}`),
					);
				}
				// Both policies are required: without them a `target=_blank` becomes a window GTK owns,
				// and a remote page could ask the process for the camera.
				if (!p.watch(web) || !p.denyCapture(web)) {
					p.close(web);
					return asFailure(
						new Error("browser.open: GTK refused the surface's signal handlers"),
					);
				}
				channel();
				store.set({
					label: input.label,
					web,
					owner: owner.label,
					onPopup: input.onPopup,
				});
				return { ok: true, label: input.label };
			} catch (error) {
				return asFailure(error);
			}
		},
		navigate(label: string, url: string): { ok: true; loaded: boolean } | BrowserFailure {
			const surface = store.mine(label, release);
			if ("ok" in surface) return surface;
			try {
				return { ok: true, loaded: port().navigate(surface.web, url) };
			} catch (error) {
				return asFailure(error);
			}
		},
		state(label: string): (BrowserState & { ok: true }) | BrowserFailure | null {
			const surface = store.mine(label, release);
			if ("ok" in surface) return surface;
			try {
				return { ok: true, ...port().state(surface.web) };
			} catch (error) {
				return asFailure(error);
			}
		},
		setBounds(label: string, bounds: BrowserBounds): { ok: true } | BrowserFailure {
			const surface = store.mine(label, release);
			if ("ok" in surface) return surface;
			try {
				const owner = port().owner(surface.owner);
				if (owner === undefined)
					return {
						ok: false,
						code: "not-found",
						message: "browser: the host window closed",
					};
				if (!port().place(owner.box, surface.web, bounds)) {
					return asFailure(
						new Error("browser.setBounds: the container refused the rectangle"),
					);
				}
				return { ok: true };
			} catch (error) {
				return asFailure(error);
			}
		},
		close(label: string): { ok: true; closed: true } | BrowserFailure {
			return store.close(label, release);
		},
		async capture(
			label: string,
		): Promise<(BrowserCapture & { ok: true }) | BrowserFailure | NotImplemented> {
			const surface = store.mine(label, release);
			if ("ok" in surface) return surface;
			return notImplemented(
				"browser.capture needs the surface's own render, and WebKitGTK's get_snapshot answers " +
					"a cairo surface this layer cannot encode",
				"webkit_web_view_get_snapshot",
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
