/**
 * What AppKit reports about a window, as the liveness rule needs it.
 *
 * `appHidden` is separate because hiding the app orders every window out and is
 * not a close.
 */
export interface WindowLivenessState {
	visible: boolean;
	miniaturized: boolean;
	appHidden: boolean;
	/** Whether AppKit still lists the window in `-[NSApplication windows]`. */
	inAppWindows: boolean;
}

/**
 * Whether a window is still open, from the three AppKit reads that answer it. **`-windowNumber` is not a liveness test** — that is what broke `window-all-closed` for every crust app. Measured 2026-11-13 on macOS 27: `-close` takes effect immediately (`isVisible` 1 → 0 within 1.02 ms, still 0 after 1 s of pumping) while the device number never clears — 517 stayed 517 through `-close`, a second window stayed 518 through `-orderOut:` then `-close`. AppKit keeps the number for the life of the object, so `windowNumber === 0` can only detect a window never ordered in.
 * The measured rule: visible → open (and after an unhide); miniaturised → open, not visible and definitely not closed; app hidden → open, since Cmd+H orders every window out without closing one; none of those → closed, including one never ordered in.
 *
 * `appHidden` alone cannot separate a closed window from one Cmd+H ordered out: both answer `isVisible=0, isMiniaturized=0`, so a hidden app resurrected a closed window. `inAppWindows` (`-[NSApplication windows]` membership) is the authoritative open/closed fact — `-close` removes the window from that array immediately — and gates the three-state rule (measured defect, 2026-11).
 */
export function windowLiveness(state: WindowLivenessState): boolean {
	// A closed window is no longer in -windows, so it must not borrow appHidden
	// to read open. Fail closed only when the authoritative read was available.
	if (!state.inAppWindows) return false;
	return state.visible || state.miniaturized || state.appHidden;
}
