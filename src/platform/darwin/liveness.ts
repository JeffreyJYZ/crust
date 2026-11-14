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
}

/**
 * Whether a window is still open, from the three AppKit reads that answer it.
 *
 * **`-windowNumber` is not a liveness test**, which is what broke
 * `window-all-closed` for every crust app. Measured 2026-11-13 on macOS 27:
 * `-close` takes effect immediately (`isVisible` 1 → 0 within 1.02 ms of the
 * send, still 0 after 300 ms and after 1 s of pumping) and the window device
 * number never clears — 517 stayed 517 through `-close`, and a second window
 * stayed 518 through `-orderOut:` followed by `-close`. AppKit keeps the number
 * for the life of the window object, so a window that has been shown once
 * reports a non-zero number forever and `windowNumber === 0` can only ever
 * detect a window that was never ordered in.
 *
 * The measured rule instead:
 *
 *   - visible        → open (the normal case, and after an unhide)
 *   - miniaturised   → open: not visible, and definitely not closed
 *   - app hidden     → open: Cmd+H orders every window out without closing one
 *   - none of those  → closed, including a window never ordered in
 */
export function windowLiveness(state: WindowLivenessState): boolean {
	return state.visible || state.miniaturized || state.appHidden;
}
