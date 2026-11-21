/**
 * The browser surfaces this process has open on Windows and Linux, and the one rule their teardown
 * follows: a surface's webview and its map entry go together, so a closed host window never leaves
 * one answering a stale title.
 *
 * Keyed by the label the page passes and deliberately **not** in either window registry: that map is
 * one window per label, and an overlay inside a window is not a window. The darwin store carries a
 * host `NSView` as well because AppKit frames two objects; these two platforms position the webview
 * itself, so a surface here is the handle and its owner.
 */
import type { BrowserFailure } from "@/plugins/browser";
import { absent } from "@/plugins/browser-failures";

export interface Surface<T> {
	label: string;
	/** The platform's own handle: an `ICoreWebView2`'s index, or a `WebKitWebView *`. */
	web: T;
	/** The window label the surface was opened in; its close prunes the surface. */
	owner: string;
	onPopup?: (url: string) => void;
}

export interface SurfacePorts<T> {
	windowOpen(label: string): boolean;
	/** Remove one surface's webview; each platform's own call, tolerant of a window already gone. */
	release(surface: Surface<T>): void;
}

export class SurfaceStore<T> {
	readonly #surfaces = new Map<string, Surface<T>>();

	has(label: string): boolean {
		return this.#surfaces.has(label);
	}

	get(label: string): Surface<T> | undefined {
		return this.#surfaces.get(label);
	}

	set(surface: Surface<T>): void {
		this.#surfaces.set(surface.label, surface);
	}

	delete(label: string): void {
		this.#surfaces.delete(label);
	}

	/** Every open surface, for the one lookup a popup event needs. */
	values(): Surface<T>[] {
		return [...this.#surfaces.values()];
	}

	/**
	 * This label's surface, or `not-found` — including a surface whose host window has since closed,
	 * which is torn down here rather than answering a title nobody can see.
	 */
	mine(label: string, ports: SurfacePorts<T>): Surface<T> | BrowserFailure {
		const surface = this.#surfaces.get(label);
		if (surface === undefined) return absent(label);
		if (ports.windowOpen(surface.owner)) return surface;
		ports.release(surface);
		this.#surfaces.delete(label);
		return absent(label);
	}

	/** Close one surface by label; `not-found` for a label nothing names. */
	close(label: string, ports: SurfacePorts<T>): { ok: true; closed: true } | BrowserFailure {
		const surface = this.#surfaces.get(label);
		if (surface === undefined) return absent(label);
		ports.release(surface);
		this.#surfaces.delete(label);
		return { ok: true, closed: true };
	}
}
