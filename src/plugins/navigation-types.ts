/**
 * The `crust:navigation` contract: what a delegate callback reports, what the webview's state is,
 * and the adapter a platform supplies. Split from `navigation.ts` so the seam a platform
 * implements reads on its own, apart from the six command handlers that use it — the same shape
 * `clipboard-contract.ts` gives `crust:clipboard`.
 */

/** The four delegate callbacks, as the event names minus their prefix. */
export type NavigationEventKind = "did-start" | "did-commit" | "did-finish" | "did-fail";

/** What a callback carries. `message` is present on `did-fail` when WebKit named a reason. */
export interface NavigationEventPayload {
	url: string;
	title: string;
	message?: string;
}

/** What the webview is doing now. An empty `url` means it has not committed a load yet. */
export interface NavigationState {
	url: string;
	title: string;
	loading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
}

/** An adapter's install answer. `status` is the native half's own number, never optimism. */
export interface NavigationInstall {
	ok: boolean;
	status: number;
	reason: string;
}

/**
 * A refused command. `handler-error` is the webview's own answer; `bad-request` is the
 * resolver refusing a label that names no open window, kept apart because it is the one
 * failure the caller can fix.
 */
export interface NavigationFailure {
	ok: false;
	code: "handler-error" | "bad-request";
	message: string;
}

/**
 * Which window a command acts on. Omitted means the app's first open window, which is what a
 * single-window caller has always meant; a label that names no open window is `bad-request`
 * naming it, never a silent fall back to that first window.
 */
export interface NavigationArgs {
	label?: string;
}

/** `loadUrl` aims one window's webview at a URL; the label picks the window as it does everywhere else. */
export interface NavigationLoadUrlArgs extends NavigationArgs {
	url: string;
}

/**
 * The native half. The plugin owns the event names; the adapter owns the webview.
 * Every member takes the window label last, so the plugin can aim one command at one window
 * and a caller that passes nothing keeps the single-window behaviour it had before.
 */
export interface NavigationAdapter {
	/** Install the delegate on one window's webview and report every callback to `listener`. */
	start(
		listener: (kind: NavigationEventKind, payload: NavigationEventPayload) => void,
		label?: string,
	): NavigationInstall;
	/** Remove the delegate; a stopped webview reports nothing. */
	stop(label?: string): void;
	/** The state now, or `null` when there is no webview to ask. */
	state(label?: string): NavigationState | null;
	reload(label?: string): boolean;
	goBack(label?: string): boolean;
	goForward(label?: string): boolean;
	/**
	 * Start a load of `url`. Optional: a platform whose webview cannot be pointed
	 * at an arbitrary URL leaves this out, and the plugin answers `not-implemented`
	 * naming `loadRequest:` instead of pretending a load began.
	 */
	loadUrl?(url: string, label?: string): boolean;
}
