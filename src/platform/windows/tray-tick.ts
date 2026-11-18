/**
 * The one tray call the pump owes every tick.
 *
 * The Windows tray records the row the human chose and hands it back from `shim_tray_click`; nothing
 * calls into JavaScript when a Win32 message arrives, so without a poll per tick a menu click is
 * recorded and never relayed — a tray that silently does nothing. This module is the slot the plugin
 * registry fills and the platform pump drains, the same shape `active-platform.ts` uses, because the
 * registry builds the adapter and the platform owns the timer.
 *
 * **Cheap by contract.** It runs on every pump slice, so it allocates nothing and blocks on nothing:
 * with no tray wired it is one `undefined` check, and with one it is a single recorded-int read. The
 * one exception is the very first poll of a process that never called the tray: that call compiles the
 * unit (`cc()`, 3–20 ms, once per process), the same first-call cost the window shim pays.
 */
import type { WindowsTrayAdapter } from "./tray-adapter.ts";

/** What the pump needs from the tray; a test may pass a bare fake of this shape. */
export type PollableTray = Pick<WindowsTrayAdapter, "pollClick">;

let active: PollableTray | undefined;

/** Called by the registry when it wires `tray`; `undefined` clears it, which is what a teardown wants. */
export function setActiveWindowsTray(tray: PollableTray | undefined): void {
	active = tray;
}

/** The adapter the pump will poll — the same shape `activeWindowsPlatform()` exposes, for a test. */
export function activeWindowsTray(): PollableTray | undefined {
	return active;
}

/**
 * Read at most one recorded click and relay it, answering the row index or -1. The adapter fires the
 * plugin's own `onClick` wiring, which is what pushes `tray:click` to the page.
 */
export function pollTrayTick(): number {
	return active === undefined ? -1 : active.pollClick();
}
