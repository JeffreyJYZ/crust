/**
 * The browser surfaces this process has open, and the one rule their teardown follows: a surface's
 * views, its navigation delegate and its map entry go together, so a closed window never leaves one
 * answering a stale title.
 *
 * Surfaces are keyed by the label the page passes and are deliberately **not** in `WindowRegistry`:
 * that map is one window per label, and an overlay inside a window is not a window.
 */
import type { BrowserFailure } from "@/plugins/browser";
import { absent } from "./browser-errors";
import type { BrowserPorts } from "./browser-ports";

export interface Surface {
	label: string;
	web: number;
	view: number;
	/** The window label the surface was opened in; its close prunes the surface. */
	owner: string;
	onPopup?: (url: string) => void;
}

export class SurfaceStore {
	readonly #surfaces = new Map<string, Surface>();

	has(label: string): boolean {
		return this.#surfaces.has(label);
	}

	get(label: string): Surface | undefined {
		return this.#surfaces.get(label);
	}

	set(surface: Surface): void {
		this.#surfaces.set(surface.label, surface);
	}

	delete(label: string): void {
		this.#surfaces.delete(label);
	}

	/** The surface one WKWebView belongs to, for a delegate callback that carries only the view. */
	byWeb(web: number): Surface | undefined {
		for (const surface of this.#surfaces.values()) {
			if (surface.web === web) return surface;
		}
		return undefined;
	}

	/**
	 * This label's surface, or `not-found` — including a surface whose host window has since closed,
	 * which is torn down here rather than answering a title nobody can see.
	 */
	mine(label: string, ports: BrowserPorts): Surface | BrowserFailure {
		const surface = this.#surfaces.get(label);
		if (surface === undefined) return absent(label);
		if (ports.windowOpen(surface.owner)) return surface;
		teardown(surface, ports);
		this.#surfaces.delete(label);
		return absent(label);
	}
}

/** Remove one surface's views and delegates; each step is tolerant of a window that already went. */
export function teardown(surface: Surface, ports: BrowserPorts): void {
	try {
		ports.navUninstall(surface.web);
	} catch {
		// The delegate may already be gone with a closed window.
	}
	try {
		ports.removeWebview(surface.web);
		ports.native.shim_browser_detach(surface.view);
	} catch {
		// A webview already detached by its window is not an error.
	}
}
