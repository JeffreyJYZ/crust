// --- snapshot prime: force AppKit's composited bit on a webview's window ------
// PRIVATE NSWindow SPI `-[NSWindow _setOcclusionStateIsVisible:]`, harness only.
// NEVER a shipped default: `snapshot.ts` refuses `prime` in a production build or
// when the C sources are not on disk (a compiled app carries them under $bunfs).
//
// Why it exists, measured 2026-11-25: an accessory app that never activates has a
// window whose `occlusionState` is 8192 — bit 2, the composited flag, is absent.
// `takeSnapshot` then never calls its completion handler. Four public wake-ups
// (orderBack on screen, alpha 0.01, 1x1 alpha 0, -[NSWindow display]) all left the
// bit at 8192 and all timed out; even an opaque 120x90 window ordered front at
// (20,20) stayed at 8192. This selector flips 8192 -> 8194 and the picture answers
// in 17 ms. That is the whole reason for the private call.
//
// The webview owns no window API of its own, so the window comes from -[NSView
// window]. `shot_has` is 123_snapshot.c's guarded respondsToSelector: check; no
// send goes to a receiver that does not implement the selector.

static shot_t shot_prime_window(shot_t web) {
	if (!web || !shot_has(web, "window")) return 0;
	return ((shot_t (*)(void *, void *))objc_msgSend)(web, sel_registerName("window"));
}

/** 1 only when the private setter exists on this webview's window; sends nothing else. */
int crust_shot_prime_available(shot_t web) {
	shot_t win = shot_prime_window(web);
	if (!win) return 0;
	return shot_has(win, "_setOcclusionStateIsVisible:");
}

/** Set (1) or clear (0) the composited bit. 1 only when the selector existed. */
int crust_shot_prime(shot_t web, int enabled) {
	shot_t win = shot_prime_window(web);
	if (!win || !shot_has(win, "_setOcclusionStateIsVisible:")) return 0;
	((void (*)(void *, void *, char))objc_msgSend)(
	    win, sel_registerName("_setOcclusionStateIsVisible:"), enabled ? 1 : 0);
	return 1;
}

/** The public read, so a test can prove the bit was restored without a snapshot. */
int crust_shot_composited(shot_t web) {
	shot_t win = shot_prime_window(web);
	if (!win || !shot_has(win, "occlusionState")) return 0;
	return (((long long (*)(void *, void *))objc_msgSend)(
	            win, sel_registerName("occlusionState")) &
	        2LL)
	    ? 1
	    : 0;
}
