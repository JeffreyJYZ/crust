/**
 * The committed-navigation gate shared by the Windows adapter's two commit paths: WebView2's
 * `NavigationStarting` event (kind 1) and its refused-new-window event (kind 0), plus the adapter's
 * own `navigate` call. The embedded-surfaces lane supplies `onNavigate`; this lane consults it.
 *
 * The event body is a plain function so a test can drive the native path on a machine with no
 * WebView2. Only the thin JSCallback wrapper needs bun:ffi.
 */
import { FFIType, JSCallback } from "bun:ffi";

const I32 = FFIType.i32;
const P = FFIType.ptr;

/** One decision. A handler that throws refuses the commit rather than slipping past the gate. */
export function navigationAllowed(
	decide: ((url: string) => boolean) | undefined,
	url: string,
): boolean {
	if (decide === undefined) return true;
	try {
		return decide(url) !== false;
	} catch {
		return false;
	}
}

/**
 * The surface's own first load already passed the plugin's entry check. Let it through untouched; a
 * redirect or any later navigation goes through the decision. Keeping this in both adapters makes
 * the Windows and Linux semantics identical.
 */
export function firstLoadAware(
	configured: string,
	decide: (url: string) => boolean,
): (url: string) => boolean {
	let first = true;
	return (url) => {
		if (first) {
			first = false;
			if (url === configured) return true;
		}
		return decide(url);
	};
}

/** Per-surface decisions, keyed by the label the adapter already owns. */
export class NavigationDecisions {
	readonly #map = new Map<string, (url: string) => boolean>();

	set(label: string, decide: (url: string) => boolean): void {
		this.#map.set(label, decide);
	}

	get(label: string): ((url: string) => boolean) | undefined {
		return this.#map.get(label);
	}

	delete(label: string): void {
		this.#map.delete(label);
	}
}

/** The seam the native events and the adapter use, kept narrow so a fake can be exact. */
export interface NavigationParts<S> {
	find(web: number): S | undefined;
	labelOf(surface: S): string;
	urlOf(kind: number): string;
	decide(label: string): ((url: string) => boolean) | undefined;
	onPopup(surface: S, url: string): void;
	setSink(pointer: number): void;
}

/**
 * One event from C. Kind 0 is a refused new window: consult the decision, then report it. Kind 1 is
 * a NavigationStarting commit: 0 cancels it in WebView2 via `put_Cancel`, leaving the previous URL.
 */
export function decideNavigation<S>(parts: NavigationParts<S>, kind: number, web: number): number {
	const surface = parts.find(web);
	// An unmatched web pointer is a navigation from a surface the store does not know — a fast
	// redirect during setup or a late event from a dying webview. Allowing it would bypass the
	// origin decision entirely, so fail closed. `browser.open` registers the surface before it
	// attaches the handlers, which keeps the normal first load from being cancelled by this rule.
	if (surface === undefined) return 0;
	const url = parts.urlOf(kind);
	if (!navigationAllowed(parts.decide(parts.labelOf(surface)), url)) return 0;
	if (kind === 0) parts.onPopup(surface, url);
	return 1;
}

/** The JSCallback C calls; its int return is read only for kind 1. */
export function navigationChannel<S>(parts: NavigationParts<S>): JSCallback {
	const callback = new JSCallback(
		(kind: number, _count: number, web: number) => {
			try {
				return decideNavigation(parts, kind, web);
			} catch {
				// A page listener that throws must not unwind into WebView2's callback.
				return 0;
			}
		},
		{ args: [I32, I32, P], returns: I32 },
	);
	parts.setSink(callbackPointer(callback));
	return callback;
}

export function callbackPointer(callback: JSCallback): number {
	const raw: unknown = callback.ptr;
	const value = typeof raw === "number" ? raw : typeof raw === "bigint" ? Number(raw) : 0;
	if (value === 0) throw new Error("crust: JSCallback exposed no usable pointer");
	return value;
}
