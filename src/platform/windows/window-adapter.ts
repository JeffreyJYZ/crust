/**
 * The native half of `crust:window` on Windows, built on the `WindowsPlatform` the runtime created
 * and on the same user32 shim that platform calls. Nothing here re-implements window creation:
 * `create` is `WindowsPlatform.createWindow` plus the two facts that method cannot know — a label
 * already held, and the document a relative URL resolves against — both read from the platform.
 *
 * **Coordinates are Win32's**: origin at the primary display's top-left, `y` growing downward,
 * matching `crust:screen`'s Windows half (whose own comment says the flip lives in the darwin half).
 * That is also why `positioner` is *not* wired here — its nine placements are computed in AppKit's
 * bottom-left space, so a y-down adapter would put a `topLeft` window at the bottom of the screen.
 *
 * A member this file omits — always-on-top, fullscreen, decorations, opacity and the pointer — is a
 * refusal by name (`unknown-adapter`, naming the member) from `window-state.ts` and
 * `window-chrome.ts`. Each needs a read-back Win32 does not give the shim in one call: `GWL_EXSTYLE`
 * for always-on-top, a style save/restore plus monitor geometry for fullscreen, a layered-window
 * alpha for opacity. A toggle that cannot be read back is the fake this adapter must not ship.
 */
import { WindowAdapterError, type WindowNative } from "@/plugins/window";
import { activeWindowsPlatform } from "./active-platform.ts";
import type { WindowsPlatform } from "./platform.ts";
import { cstring } from "./cstring.ts";
import { type WindowsNativeWindow, windowsWindowStateAdapter } from "./window-state-adapter.ts";

export function windowsWindowAdapter(
	platform: () => WindowsPlatform | undefined = activeWindowsPlatform,
): WindowNative {
	const attached = (): WindowsPlatform => {
		const current = platform();
		if (current === undefined) {
			throw new WindowAdapterError(
				"unknown-adapter",
				"crust: no Windows platform is attached, so no window command can be answered",
			);
		}
		return current;
	};

	/** A label the platform still tracks, with its handle; anything else is `unknown-window`. */
	const require = (label: string): WindowsNativeWindow => {
		const current = attached();
		const hwnd = current.nativeWindow(label);
		if (hwnd === undefined) {
			throw new WindowAdapterError(
				"unknown-window",
				`crust: no window labelled ${JSON.stringify(label)}`,
			);
		}
		const shim = current.shim();
		if (shim === undefined) {
			throw new WindowAdapterError(
				"handler-error",
				"crust: the Windows shim is not loaded — window commands need a started platform",
			);
		}
		return { hwnd, shim };
	};

	/**
	 * The app's own document, as an absolute base: the bridge URL a configured window was asked to
	 * load. `about:blank` is skipped, because resolving against it yields nothing loadable.
	 */
	const documentBase = (current: WindowsPlatform): URL => {
		for (const label of current.windowLabels()) {
			const url = current.windowUrl(label);
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

	/** Absolute URLs load as given; a relative one joins the app's own document, query included. */
	const resolveDocument = (current: WindowsPlatform, url: string | undefined): string => {
		if (url !== undefined && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return url;
		return new URL(url ?? "/", documentBase(current)).toString();
	};

	return {
		/**
		 * One `platform.window(label)` answers both questions: a handle means a live window and is
		 * refused, `undefined` means absent *or* closed and the call has already pruned the closed
		 * entry — so a label nobody can see in `list` is free to create.
		 */
		create(options): { label: string } {
			const current = attached();
			if (current.window(options.label) !== undefined) {
				throw new WindowAdapterError(
					"duplicate-label",
					`crust: a window labelled ${JSON.stringify(options.label)} is already open`,
				);
			}
			return current.createWindow({
				...options,
				url: resolveDocument(current, options.url),
			});
		},

		/** The controller goes first, then the window; the registry prunes the label on liveness. */
		close(label: string): void {
			require(label);
			attached().destroy(label);
		},

		focus(label: string): void {
			const native = require(label);
			if (Number(native.shim.shim_window_focus(native.hwnd)) === 1) return;
			// SetForegroundWindow answers 0 while Windows' foreground lock holds. That is a real
			// refusal, not a crash: the page learns the window was not raised.
			throw new WindowAdapterError(
				"handler-error",
				`crust: window ${JSON.stringify(label)} was not raised — ` +
					`SetForegroundWindow answered 0 (GetLastError ${Number(native.shim.shim_last_error())})`,
			);
		},

		/**
		 * `SetWindowTextW` answers whether it applied, and that is the whole proof available: a
		 * read-back would need `GetWindowTextW`, which the shim does not bind. A refusal is an error
		 * rather than a silent title, which is the half of darwin's read-back rule Windows can keep.
		 */
		setTitle(label: string, title: string): void {
			const native = require(label);
			if (Number(native.shim.shim_window_set_title(native.hwnd, cstring(title))) === 1)
				return;
			throw new WindowAdapterError(
				"handler-error",
				`crust: window ${JSON.stringify(label)} refused the title ` +
					`(SetWindowTextW, GetLastError ${Number(native.shim.shim_last_error())})`,
			);
		},

		list(): string[] {
			return attached().windowLabels();
		},

		/**
		 * Win32 answers liveness with `IsWindow`, and the registry prunes a closed label on read — so
		 * a label that is gone answers `unknown-window` rather than `false`: unlike AppKit there is
		 * no handle left to tell "closed" from "never existed".
		 */
		isOpen(label: string): boolean {
			const native = require(label);
			return Number(native.shim.shim_window_is_open(native.hwnd)) === 1;
		},

		// Size, position, minimize and maximize live in their own module, on the same `require`.
		...windowsWindowStateAdapter(require),
	};
}
