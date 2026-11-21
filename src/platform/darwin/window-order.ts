/**
 * Showing a window and deciding whether a create may take the front.
 *
 * Split out of `window-create.ts` so the create/activate split is provable with a recording double:
 * `activate: false` is the passive create — on screen, never key, and no activation selector — and
 * that is a decision about two sends, not about AppKit.
 *
 * The measured background: `-makeKeyAndOrderFront:` raises a window but still depends on the app
 * being able to activate, and macOS 14+ refuses that for a process LaunchServices did not start —
 * which is exactly how `crust dev` runs (2026-11-16: the window was built, its page loaded, and it
 * was still off screen and out of the accessibility tree). `orderFrontRegardless` is what puts it
 * on screen without that gate, and `-activateIgnoringOtherApps:` is the call that lands when a
 * create *is* allowed to raise the app.
 */
import type { ActivateMode } from "@/config";
import { S } from "./objc.ts";

/** The two ordering sends, injected so a test records them instead of building an `NSWindow`. */
export interface WindowOrderSends {
	/** Take key and order front — the half a passive create must not send. */
	makeKeyAndOrderFront(): void;
	/** Order front without activation: the send that makes a passive window visible. */
	orderFrontRegardless(): void;
}

/** The real sends for one `NSWindow *`. */
export function windowOrderSends(win: number): WindowOrderSends {
	return {
		makeKeyAndOrderFront: () => S.v1(win, "makeKeyAndOrderFront:", 0),
		orderFrontRegardless: () => S.v0(win, "orderFrontRegardless"),
	};
}

/**
 * Order the window on screen. `activate: false` skips the key send entirely, so the window is shown
 * and nothing else — the caller's window never becomes key while the human is in another app.
 */
export function raiseWindow(activate: boolean | undefined, sends: WindowOrderSends): boolean {
	if (activate !== false) sends.makeKeyAndOrderFront();
	sends.orderFrontRegardless();
	return activate !== false;
}

/**
 * The activation a create may send. `activate: false` answers `never` whatever `app.activate` says,
 * which is what keeps a passive create from sending `-activateIgnoringOtherApps:` at all.
 */
export function createActivation(mode: ActivateMode, activate: boolean | undefined): ActivateMode {
	return activate === false ? "never" : mode;
}
