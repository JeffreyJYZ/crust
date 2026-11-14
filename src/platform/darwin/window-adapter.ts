import { WindowAdapterError, type WindowNative } from "@/plugins/window";
import { shim } from "./index.ts";
import { cstr, S } from "./objc.ts";
import type { DarwinPlatform } from "./platform.ts";

// --- window adapter --------------------------------------------------------

/**
 * The native half of `crust:window` on macOS, built on the `DarwinPlatform` the runtime attached because the labels and `NSWindow *` pointers already live there. `close` sends `-close` and the object stays addressable via `setReleasedWhenClosed: 0`; `isOpen` reads the measured liveness rule, never raw `-windowNumber` (a closed window keeps its device number and a minimised one is open but not visible).
 * `focus` activates at most once per process through `DarwinPlatform.activateOnce`, so switching does not make the Dock icon jump. `create` is `DarwinPlatform.createWindow` and nothing else: the adapter adds only the two facts that method cannot know — live label or stale closed one, and what the app's document is — both read from the platform. Every selector is in `PREFLIGHT`, so a system that cannot do this fails `start()` by name instead of aborting.
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
	 * The app's own document, as an absolute base URL. Neither `CRUST_BRIDGE_URL` nor `.crust/dev.json` is usable — the runtime publishes them only when a dev server exists, and a built app runs from `/` with no handshake — so the base is the first tracked window whose URL is a real web URL, skipping one loaded as `about:blank` because resolving against it yields nothing loadable.
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
		 * One `platform.window(label)` answers both questions: a handle means a live window and is refused, `undefined` means absent *or* closed and the call has already pruned the closed entry — which stops `createWindow` refusing a label nobody can see in `list`. The live case throws before any release.
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
