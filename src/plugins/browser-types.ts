/**
 * The `crust:browser` contract: a positioned second webview inside one of the app's windows.
 * Split from `browser.ts` so the seam a platform implements reads on its own, the same shape
 * `navigation-types.ts` gives `crust:navigation`.
 *
 * The surface is an **overlay**, not a DOM element: the app supplies a rectangle in window points
 * and reserves the space itself. It loads remote content under its own webview configuration, so it
 * carries no bridge token and `window.crust` does not exist inside it.
 */
import type { NotImplemented } from "./define";

/** The rectangle the app reserves, in window points. AppKit's origin is bottom-left. */
export interface BrowserBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** What the surface is doing now; an empty `url` means it has not committed a load yet. */
export interface BrowserState {
	url: string;
	title: string;
	loading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
}

/** The surface's own render: a real picture of the embedded page, never the app page behind it. */
export interface BrowserCapture {
	width: number;
	height: number;
	scale: number;
	/** Base64 PNG, no `data:` prefix. */
	png: string;
}

/** The codes a refusal may carry. `not-found` is an unknown surface, `bad-request` a caller's. */
export type BrowserFailureCode = "bad-request" | "not-found" | "handler-error";

export interface BrowserFailure {
	ok: false;
	code: BrowserFailureCode;
	message: string;
}

/** What `open` hands the adapter. `onPopup` fires when the surface's page asks for a new webview. */
export interface BrowserOpenInput {
	label: string;
	url: string;
	bounds: BrowserBounds;
	/** The window label the calling page named; an absent one is the app's first open window. */
	owner?: string;
	onPopup?: (url: string) => void;
	/**
	 * The surface's navigation decision — the origin gate AFTER `open`. Entry checks in the plugin
	 * cannot see a load the page starts by itself, so this callback is the only place the allowlist
	 * can hold once the surface exists.
	 *
	 * EVERY adapter MUST consult it before committing EVERY navigation of this surface: the first
	 * load, clicks, scripted `location =`, every hop of a redirect chain, and the `target=_blank`
	 * handoff to the system opener. When it answers false the adapter MUST refuse the navigation —
	 * cancel it, never load the target, never hand the URL on. An adapter that merely stores this
	 * callback and ignores it leaves `browser.origins` gating entry only, which is the HIGH finding
	 * this contract exists to close; a real platform that skips it is broken in every built app.
	 *
	 * The three platform calls that owe this decision:
	 *   - macOS: WKNavigationDelegate `webView:decidePolicyForNavigationAction:decisionHandler:`
	 *   - Windows: WebView2 `NavigationStarting` (`put_Cancel(TRUE)` when the decision is false)
	 *   - Linux: WebKitGTK `decide-policy` (ignore the decision when the answer is false)
	 * The plugin only decides; the platform owns the cancel. `assertNavigationDecision` in
	 * `browser-navigation-contract.ts` checks any adapter that implements this interface, and fails
	 * a stub that ignores the callback.
	 */
	onNavigate?: (url: string) => boolean;
}

/** What handing a refused popup to the OS opener answered. */
export interface BrowserExternalOutcome {
	opened: boolean;
	reason?: string;
}

/**
 * The native half. Every method answers a plain object; an adapter that throws becomes
 * `handler-error` in the plugin, never a rejected invoke.
 *
 * `capture` may answer `NotImplemented`: a platform whose webview renders no picture says which API
 * it is missing rather than sending a screenshot of the screen, which would be a picture of
 * something else entirely.
 */
export interface BrowserAdapter {
	open(input: BrowserOpenInput): { ok: true; label: string } | BrowserFailure;
	navigate(label: string, url: string): { ok: true; loaded: boolean } | BrowserFailure;
	/** The state now, or `null` when no surface carries that label. */
	state(label: string): (BrowserState & { ok: true }) | BrowserFailure | null;
	setBounds(label: string, bounds: BrowserBounds): { ok: true } | BrowserFailure;
	close(label: string): { ok: true; closed: true } | BrowserFailure;
	/** The surface's own webview render, so a caller can see what it embedded. */
	capture(
		label: string,
	): Promise<(BrowserCapture & { ok: true }) | BrowserFailure | NotImplemented>;
	/** Hand one refused `target=_blank` URL to the system opener. */
	external(url: string): BrowserExternalOutcome;
}
