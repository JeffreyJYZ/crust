import { WindowAdapterError, type WindowNative } from "@/plugins/window";
import { shim } from "./index.ts";
import { cstr, S } from "./objc.ts";
import type { DarwinPlatform } from "./platform.ts";

// --- window adapter --------------------------------------------------------

/**
 * The native half of `crust:window` on macOS.
 *
 * Built on the `DarwinPlatform` instance the runtime attached, because the
 * labels and the `NSWindow *` pointers already live there. Two facts carry the
 * whole liveness rule:
 *
 *   - `close` sends `-close`, which orders the window out at once. The object
 *     stays addressable because `setReleasedWhenClosed: 0` was applied at
 *     creation, which is what lets the liveness read still work afterwards.
 *   - `isOpen` reads the platform's measured liveness rule, never raw
 *     `-windowNumber`: a closed window keeps its device number (measured), and a
 *     minimised window is not visible yet still open.
 *
 * `focus` orders the window front and activates the app at most once per
 * process through `DarwinPlatform.activateOnce`, so calling it on every switch
 * does not make the Dock icon keep jumping.
 *
 * `create` is `DarwinPlatform.createWindow` and nothing else: that method already
 * builds the `initWithContentRect:` window, adds and pins the webview, applies
 * the title and size, orders it front and tracks the label. The adapter's only
 * jobs are the two facts that method cannot know — whether the label is a live
 * window or a stale closed one, and what "the app's own document" is — and both
 * are read from the platform, never guessed.
 *
 * Every selector here is in `PREFLIGHT`, so a system that cannot do this fails
 * `start()` with a name instead of aborting on an uncaught ObjC exception.
 */
export function darwinWindowAdapter(platform: DarwinPlatform): WindowNative {
	const require = (label: string): number => {
		const win = platform.nativeWindow(label);
		if (win === undefined) {
			throw new WindowAdapterError(
				"unknown-window",
				`crust: no window labelled ${JSON.stringify(label)}`,
			);
		}
		return win;
	};

	/**
	 * The app's own document, as an absolute base URL.
	 *
	 * Neither `CRUST_BRIDGE_URL` nor `.crust/dev.json` is usable here: the runtime
	 * only publishes them when a dev server exists, and a built app runs from `/`
	 * where there is no handshake. What *is* true is that the app's windows were
	 * loaded with that document, and `DarwinPlatform` recorded each one — so the
	 * first tracked window whose URL is a real web URL is the base. A window
	 * loaded as `about:blank` (a caller handed the platform a relative URL) is
	 * skipped, because resolving against it would produce nothing loadable.
	 */
	const documentBase = (): URL => {
		for (const label of platform.windowLabels()) {
			const url = platform.windowUrl(label);
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
		/**
		 * One `platform.window(label)` call answers both questions at once: a
		 * handle means the label is a live window and must be refused, and
		 * `undefined` means absent *or* closed — and the call has already pruned
		 * the closed entry, which is what stops `createWindow` from refusing a
		 * label nobody can see in `list`. Releasing a closed window is not
		 * replacing an open one: the live case throws before any release.
		 */
		create(options): { label: string } {
			const live = platform.window(options.label);
			if (live !== undefined) {
				throw new WindowAdapterError(
					"duplicate-label",
					`crust: a window labelled ${JSON.stringify(options.label)} is already open`,
				);
			}
			return platform.createWindow({ ...options, url: resolveDocument(options.url) });
		},
		close(label: string): void {
			S.v0(require(label), "close");
		},

		focus(label: string): void {
			S.v1(require(label), "makeKeyAndOrderFront:", 0);
			platform.activateOnce();
		},

		/**
		 * The title is built and applied inside `shim_window_set_title`, because
		 * a short ASCII NSString is a tagged pointer and cannot be marshalled
		 * through bun:ffi. The applied title is read back, so a silent no-op
		 * becomes an error rather than a success.
		 */
		setTitle(label: string, title: string): void {
			const win = require(label);
			shim().symbols.shim_window_set_title(win, cstr(title));
			const applied = String(shim().symbols.shim_window_title_utf8(win) ?? "");
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

		isOpen(label: string): boolean {
			const number = platform.windowNumber(label);
			if (number === undefined) {
				throw new WindowAdapterError(
					"unknown-window",
					`crust: no window labelled ${JSON.stringify(label)}`,
				);
			}
			return number !== 0;
		},
	};
}
