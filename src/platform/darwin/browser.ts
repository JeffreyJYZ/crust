/**
 * The macOS half of `crust:browser`: a second `WKWebView` inside one of the app's windows, above the
 * app's own page and sized by the caller.
 *
 * Three things decide this module's shape.
 * - **Its own configuration.** The app's shared `WKWebViewConfiguration` carries the bridge's user
 *   scripts and the `crust-net` scheme handler; a remote page built from it would receive a bridge
 *   transport on an untrusted origin. `shim_webview_configuration()` alloc-inits a new object on
 *   every call, so `realPorts` asks for a fresh one and never touches `webviewConfiguration()`.
 * - **The capture denial is part of the surface.** `shim/132_browser_ui.c` installs a
 *   `WKUIDelegate` that denies media capture and refuses every new webview; reusing the app's
 *   capture delegate would clobber the new-window policy, because a webview has exactly one.
 * - **Navigation state is already per webview**, so `state` reuses the navigation unit's reads
 *   rather than growing a second copy of `-URL` / `-title` / `-isLoading`.
 */
import { FFIType, JSCallback, ptr } from "bun:ffi";
import type {
	BrowserAdapter,
	BrowserBounds,
	BrowserCapture,
	BrowserFailure,
	BrowserOpenInput,
	BrowserState,
} from "@/plugins/browser";
import { absent, asFailure } from "@/plugins/browser-failures";
import { type BrowserPorts, realPorts, setFrames } from "./browser-ports";
import { type Surface, SurfaceStore, teardown } from "./browser-surface";
import { BROWSER_UI_STATUS, type BrowserNative } from "./browser-unit";
import { askDecision, decideFor, installDecisionSink } from "./browser-navigation-policy.ts";
import { readCommands } from "./browser-read-commands.ts";
import { readText } from "./navigation-unit";

export { bindBrowserWindows } from "./browser-platform";
export type { BrowserNative } from "./browser-unit";

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

export function darwinBrowserAdapter(ports?: BrowserPorts): BrowserAdapter {
	const surfaces = new SurfaceStore();
	let live: BrowserPorts | undefined = ports;
	const port = (): BrowserPorts => (live ??= realPorts());

	/** Report a refused new window to the surface that asked, and to nobody else. */
	const channel = (native: BrowserNative): void => {
		if (sink === undefined) {
			sink = new JSCallback(
				(_count: number, web: number) => {
					const surface = surfaces.byWeb(Number(web));
					if (surface === undefined) return 0;
					const url = readText((into) =>
						Number(native.shim_browser_popup_url(ptr(into), into.length) ?? 0),
					);
					try {
						// A refused handoff is never passed to the system opener.
						if (askDecision(Number(web), url)) surface.onPopup?.(url);
					} catch {
						// A page listener that throws must not unwind into AppKit's delegate call.
					}
					return 0;
				},
				{ args: [I32, P], returns: V },
			);
		}
		native.shim_browser_set_sink(callbackPointer(sink));
	};

	const build = (input: BrowserOpenInput, p: BrowserPorts): Surface | BrowserFailure => {
		const owner = p.owner(input.owner);
		if (owner === undefined)
			return asFailure("browser.open: no open window to host the surface");
		const web = p.newWebview();
		if (!web) return asFailure("browser.open: WebKit refused a new WKWebView");
		const native = p.native;
		const view = Number(native.shim_browser_view_new() ?? 0);
		if (!view) return asFailure("browser.open: NSView allocation failed");

		// A half-built surface owns a +1 view, webview and configuration just like a live one.
		// Use the same teardown path as `close`, or a refused delegate or load leaks all three.
		const discard = () => {
			decideFor(web, undefined);
			teardown({ label: input.label, web, view, owner: owner.label }, p);
		};
		// A nil content view makes -addSubview: a no-op in C, which answers 0. An invisible surface
		// answered ok is worse than a refusal: tear the half-built surface down and say why.
		if (Number(native.shim_browser_attach(p.contentView(owner.win), view) ?? 0) !== 1) {
			discard();
			return asFailure("browser.open: the host window refused to attach the surface");
		}
		setFrames(native, view, web, input.bounds);
		p.addWebview(view, web);
		const ui = Number(native.shim_browser_ui_install(web) ?? BROWSER_UI_STATUS.missing);
		if (ui !== BROWSER_UI_STATUS.installed && ui !== BROWSER_UI_STATUS.already) {
			discard();
			return asFailure(`browser.open: the surface's UI delegate was refused (status ${ui})`);
		}
		// The entry check cannot see a redirect or a scripted load. Every commit of this surface
		// now asks the plugin's decision through the navigation delegate's policy method.
		installDecisionSink(p.navNative());
		decideFor(web, input.onNavigate);
		const navigation = p.navInstall(web);
		if (navigation !== 0) {
			discard();
			return asFailure(
				`browser.open: the navigation delegate was refused (status ${navigation})`,
			);
		}
		if (!p.load(web, input.url)) {
			discard();
			return asFailure(`browser.open: the surface could not load ${input.url}`);
		}
		channel(native);
		return {
			label: input.label,
			web,
			view,
			owner: owner.label,
			onPopup: input.onPopup,
		};
	};

	return {
		open(input: BrowserOpenInput): { ok: true; label: string } | BrowserFailure {
			if (surfaces.has(input.label)) {
				return {
					ok: false,
					code: "bad-request",
					message: `browser.open: a surface called ${JSON.stringify(input.label)} is already open`,
				};
			}
			try {
				const surface = build(input, port());
				if ("ok" in surface) return surface;
				surfaces.set(surface);
				return { ok: true, label: input.label };
			} catch (error) {
				return asFailure(error);
			}
		},
		navigate(label: string, url: string): { ok: true; loaded: boolean } | BrowserFailure {
			const surface = surfaces.mine(label, port());
			if ("ok" in surface) return surface;
			if (!askDecision(surface.web, url)) {
				// No load, no navigation error event: the previous page stays exactly as it was.
				return asFailure(
					"browser.navigate: the surface's navigation policy refused this URL",
				);
			}
			try {
				return {
					ok: true,
					loaded: port().load(surface.web, url) === 1,
				};
			} catch (error) {
				return asFailure(error);
			}
		},
		state(label: string): (BrowserState & { ok: true }) | BrowserFailure | null {
			const surface = surfaces.mine(label, port());
			if ("ok" in surface) return surface;
			try {
				return { ok: true, ...port().navState(surface.web) };
			} catch (error) {
				return asFailure(error);
			}
		},
		setBounds(label: string, bounds: BrowserBounds): { ok: true } | BrowserFailure {
			const surface = surfaces.mine(label, port());
			if ("ok" in surface) return surface;
			try {
				setFrames(port().native, surface.view, surface.web, bounds);
				return { ok: true };
			} catch (error) {
				return asFailure(error);
			}
		},
		close(label: string): { ok: true; closed: true } | BrowserFailure {
			const surface = surfaces.get(label);
			if (surface === undefined) return absent(label);
			decideFor(surface.web, undefined);
			teardown(surface, port());
			surfaces.delete(label);
			return { ok: true, closed: true };
		},
		...readCommands(surfaces, port),
	};
}
