/**
 * The windows a platform tracks, and the one measured rule that answers whether
 * one of them is still open.
 *
 * The registry owns nothing but the map: the AppKit object, its webview and the
 * URL it was loaded with all arrive from `createNativeWindow`.
 */
import type { WindowHandle } from "@/app.ts";
import { shim } from "./index.ts";
import { S } from "./objc.ts";
import { windowLiveness } from "./liveness.ts";

/** What a native window is, minus the platform's own handle. */
export interface NativeWindowPointers {
	win: number;
	web: number;
	/**
	 * The absolute URL this window was asked to load (`about:blank` when the
	 * caller gave a relative one, which `NSURL` cannot take as-is). Kept because
	 * a window created later resolves a relative URL against the app's own
	 * document, and this is the only place that document survives: the bridge
	 * URL is the runtime's, never the platform's.
	 */
	url: string;
}

export interface NativeWindow extends NativeWindowPointers {
	handle: WindowHandle;
}

export class WindowRegistry {
	readonly #windows = new Map<string, NativeWindow>();
	/** The `NSApplication *`, so `-isHidden` can be read; 0 before `start()`. */
	readonly #app: () => number;

	constructor(app: () => number) {
		this.#app = app;
	}

	/** Whether this label is tracked at all, open or closed. */
	has(label: string): boolean {
		return this.#windows.has(label);
	}

	/** Start tracking a freshly created window. */
	track(handle: WindowHandle, pointers: NativeWindowPointers): void {
		this.#windows.set(handle.label, { handle, ...pointers });
	}

	/**
	 * The absolute URL a tracked window was asked to load.
	 *
	 * This is what a later `window.create` resolves a relative URL against: the
	 * bridge URL is the runtime's private state (and only a dev handshake puts it
	 * in `CRUST_BRIDGE_URL` / `.crust/dev.json`, neither of which a built app
	 * running from `/` can read), while the document the app's own windows were
	 * loaded with is right here, absolute and already verified by the webview.
	 */
	url(label: string): string | undefined {
		return this.#windows.get(label)?.url;
	}

	/**
	 * Return the handle only while the window is still open.
	 *
	 * Liveness is `windowLiveness`, not `-windowNumber` (see that rule for the
	 * measurement that ruled the number out). A closed window stays addressable
	 * because `setReleasedWhenClosed: 0` was applied at creation, so its
	 * visibility can still be read after the close.
	 */
	handle(label: string): WindowHandle | undefined {
		const entry = this.#windows.get(label);
		if (!entry) return undefined;
		if (!this.#isOpen(entry.win)) {
			this.#windows.delete(label);
			return undefined;
		}
		return entry.handle;
	}

	/**
	 * The labels this platform still tracks, in creation order.
	 *
	 * A closed window stays in the map (`setReleasedWhenClosed: 0` keeps it
	 * addressable) until `handle(label)` prunes it, so this is what the
	 * platform knows about, not only what is on screen.
	 */
	labels(): string[] {
		// Only windows AppKit still holds. A closed window's native object survives on
		// purpose (the liveness read needs it), so the map alone reports windows that
		// are gone — and a page that closed a window and asked for the list saw it back.
		return [...this.#windows.entries()]
			.filter(([, entry]) => this.#isOpen(entry.win))
			.map(([label]) => label);
	}

	/** The native `NSWindow *` behind a tracked label; undefined when never created. */
	native(label: string): number | undefined {
		return this.#windows.get(label)?.win;
	}

	/**
	 * The window's AppKit window device number while it is open, or 0 once it
	 * has closed — the liveness number crust's own contract promises, not the
	 * raw `-windowNumber` (which keeps its value after a close; see
	 * `windowLiveness`). Undefined means the label was never created.
	 */
	number(label: string): number | undefined {
		const entry = this.#windows.get(label);
		if (!entry) return undefined;
		if (!this.#isOpen(entry.win)) return 0;
		return Number(shim().symbols.shim_window_number(entry.win) ?? 0);
	}

	/** Whether AppKit still holds this window open, read the measured way. */
	#isOpen(win: number): boolean {
		// Hiding the app (Cmd+H) orders every window out without closing one, so
		// it must not read as "all windows gone". A failure here fails safe: no
		// false quit, only a delayed one.
		let appHidden = false;
		const app = this.#app();
		if (app) {
			try {
				appHidden = S.b0(app, "isHidden");
			} catch {
				appHidden = false;
			}
		}
		const symbols = shim().symbols;
		return windowLiveness({
			visible: Number(symbols.shim_window_is_visible(win) ?? 0) === 1,
			miniaturized: Number(symbols.shim_window_is_miniaturized(win) ?? 0) === 1,
			appHidden,
		});
	}
}
