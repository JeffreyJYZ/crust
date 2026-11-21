/**
 * The committed-navigation gate for WebKitGTK, mirroring the Windows lane's module. A shared home
 * would live under `src/plugins/**`, which this lane must not edit, so the small seam is local to
 * each platform; the decision semantics are identical on both.
 *
 * The event body is a plain function so a test can drive the native `decide-policy` path without a
 * desktop session. Only the thin JSCallback wrapper needs bun:ffi.
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
 * The surface's own first load is not a committed navigation away from an allowed origin — the plugin
 * already checked that URL at `open`. Let it through untouched; a redirect or any later navigation
 * goes through the decision. Returning false for the first load stranded the real GTK surface with an
 * empty document (measured on ubuntu-latest 2026-11-21).
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
	find(web: bigint): S | undefined;
	labelOf(surface: S): string;
	urlOf(kind: number): string;
	decide(label: string): ((url: string) => boolean) | undefined;
	onPopup(surface: S, url: string): void;
	setSink(pointer: number): void;
}

/**
 * One event from C. Kind 0 is a refused new window, kind 1 a decide-policy navigation. 0 refuses
 * the commit; WebKitGTK ignores the decision and the surface keeps its previous page.
 */
export function decideNavigation<S>(parts: NavigationParts<S>, kind: number, web: number): number {
	const surface = parts.find(BigInt(web));
	if (surface === undefined) return 1;
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
				// A page listener that throws must not unwind into GTK's signal emission.
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
