/**
 * The native half of `crust:window` on Linux, built on the `LinuxPlatform` the runtime already
 * holds: its own label map is the answer to "which `GtkWindow *` is this label", so this file never
 * keeps a second one. `close` goes through `Platform.destroy`, the same seam `quit()` uses, and the
 * label is gone afterwards — GTK frees a destroyed widget, so unlike AppKit there is no "closed but
 * still addressable" window, which is why `isOpen` answers `unknown-window` for a closed label
 * rather than `false`.
 * `create` is `Platform.createWindow` plus the two facts that method cannot know: a label a live
 * window still holds, and what the app's document is when a relative URL is asked for. `setTitle`
 * reads its own write back, so a silent no-op is an error instead of a success.
 * UNPROVEN ON REAL GTK, like the rest of this layer: there is no GTK on the machine this was
 * written on, so the tests drive it through a fake shim and prove the shape, not the display.
 */
import { WindowAdapterError, type WindowNative } from "@/plugins/window";
import { type LinuxShim, shim } from "./shim-ffi.ts";
import type { LinuxPlatform } from "./platform.ts";
import { gtkWindowSends, refusalGate } from "./window-sends.ts";
import { windowChromeAdapter } from "./window-chrome-adapter.ts";
import { windowStateAdapter } from "./window-state-adapter.ts";

export function linuxWindowAdapter(
	platform: LinuxPlatform,
	native: LinuxShim = shim().symbols,
): WindowNative {
	const sends = gtkWindowSends(native);
	const gate = refusalGate(sends);

	/** The `GtkWindow *` a label names, refused when the platform no longer tracks it. */
	const require = (label: string): bigint => {
		const win = platform.nativeWindow(label)?.win;
		if (win === undefined) {
			throw new WindowAdapterError(
				"unknown-window",
				`crust: no window labelled ${JSON.stringify(label)}`,
			);
		}
		return win;
	};

	/**
	 * The app's own document, as an absolute base URL. Neither `CRUST_BRIDGE_URL` nor `.crust/dev.json`
	 * is usable — the runtime publishes them only when a dev server exists, and a built app runs from
	 * `/` with no handshake — so the base is the first tracked window whose URL is a real web URL,
	 * skipping one loaded as `about:blank` because resolving against it yields nothing loadable.
	 */
	const documentBase = (): URL => {
		for (const label of platform.windowLabels()) {
			const url = platform.nativeWindow(label)?.url;
			if (url === undefined || !/^https?:/i.test(url)) continue;
			try {
				return new URL(url);
			} catch {
				continue;
			}
		}
		throw new WindowAdapterError(
			"handler-error",
			"crust: window.create needs an absolute url — no open window has loaded one to resolve against",
		);
	};

	/** Absolute URLs load as given; a relative one joins the app's own document. */
	const resolveDocument = (url: string | undefined): string => {
		if (url !== undefined && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return url;
		return new URL(url ?? "/", documentBase()).toString();
	};

	return {
		// Geometry and the flags, then the title bar and the opacity, both on the same `require`.
		...windowStateAdapter(require, sends, gate),
		...windowChromeAdapter(require, sends, gate),
		create(options): { label: string } {
			// The platform's own map, not a copy: a live window holding this label is refused here,
			// and a closed one was already pruned, so re-creating it is not a duplicate.
			if (platform.window(options.label) !== undefined) {
				throw new WindowAdapterError(
					"duplicate-label",
					`crust: a window labelled ${JSON.stringify(options.label)} is already open`,
				);
			}
			const handle = platform.createWindow({ ...options, url: resolveDocument(options.url) });
			return { label: handle.label };
		},
		close(label: string): void {
			require(label);
			platform.destroy(label);
		},
		focus(label: string): void {
			gate("focus", () => sends.present(require(label)));
		},
		setTitle(label: string, title: string): void {
			const win = require(label);
			gate("setTitle", () => sends.setTitle(win, title));
			const applied = gate("setTitle", () => sends.title(win));
			if (applied !== title) {
				throw new WindowAdapterError(
					"handler-error",
					`crust: window ${JSON.stringify(label)} title applied as ${JSON.stringify(applied)}`,
				);
			}
		},
		list(): string[] {
			return platform.windowLabels();
		},
		/**
		 * GTK frees a destroyed window, so `Platform.window()` prunes its label and no closed state
		 * survives to report: a label the platform still holds is open, and one it does not is
		 * `unknown-window` — which is why this is `true` after `require` rather than a comparison.
		 */
		isOpen(label: string): boolean {
			require(label);
			return true;
		},
	};
}
