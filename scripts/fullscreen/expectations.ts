/**
 * What a fullscreen run must observe: every answer the page sends, every assertion name, the bits
 * AppKit answers with, and the one deadline the app gets.
 */

/**
 * `NSWindowCollectionBehaviorFullScreenPrimary`. The bit that turns the green button into the two
 * fullscreen arrows; a window without it is offered a zoom `+` no matter what a plugin reports.
 */
export const FULLSCREEN_PRIMARY = 128;

/**
 * `NSWindowCollectionBehaviorFullScreenAuxiliary` — "a helper that may appear inside someone else's
 * fullscreen Space". It explicitly disqualifies the window as fullscreen-primary, which is the bug
 * this proof pins: the launched window carried it and the green button stayed a zoom `+`.
 */
export const FULLSCREEN_AUXILIARY = 256;

/**
 * `NSWindowStyleMaskFullScreen`, `1 << 14`. `-isFullScreen` does not resolve on macOS 27, so this bit
 * is the only reliable read of a completed transition.
 */
export const STYLE_MASK_FULLSCREEN = 1 << 14;

/**
 * How far the page's own viewport may sit from the display's usable frame and still count as covering
 * it. Measured on this machine (a notched 1470x956 pt panel): the windowed visible frame is 840 pt
 * under the menu bar and dock, and a real fullscreen window gets 923 pt — the panel minus the 33 pt
 * notch inset, which is what `screen.availHeight` reports once the chrome is gone. A zoom is 83 pt
 * short of fullscreen here, far outside this allowance.
 */
export const COVER_TOLERANCE = 8;

/**
 * Every answer the page sends, in order. The count is the guard the whole proof rests on: a page that
 * never ran, or died half way, cannot reach it.
 */
export const EXPECTED_TAGS = [
	"label",
	"probe0",
	"space0",
	"viewport0",
	"fs",
	"probe1",
	"unfs",
	"probe2",
	"viewport2",
	"closing",
] as const;

/** The assertions that read those answers, in one place, so a failed build reports each as unchecked. */
export const FULLSCREEN_CHECKS = [
	"page label",
	"window found",
	"fullscreen primary",
	"not auxiliary",
	"on active space",
	"starts windowed",
	"enters fullscreen",
	"style mask fs",
	"covers display",
	"above visible frame",
	"space after enter",
	"leaves fullscreen",
	"mask cleared",
	"viewport restored",
	"all closed",
	"exit 0",
	"no survivors",
] as const;

/** The backend's own line once its only window is closed. */
export const ALL_CLOSED = /window\s+every window closed; quitting/;

/**
 * Nothing: the app ends itself when its last window closes, so the probe must not stop it on a line —
 * anything matching would make `exit 0` a fact about the harness rather than about the app. `(?!)/`
 * can never match; `/$^/` is unsafe because it matches an empty string.
 */
export const WAIT_FOR_EXIT = /(?!)/;

/**
 * The app opens one window, enters fullscreen, leaves it and closes: measured a few seconds, with the
 * two transitions the only wait. The headroom covers a cold WebKit start on a loaded machine.
 */
export const APP_TIMEOUT_MS = 90_000;

/** `crust build` compiles the shim and a ~90 MB binary; tens of seconds on a cold runner. */
export const BUILD_TIMEOUT_MS = 180_000;

/** `codesign -dv` is a read of the signature; seconds, never minutes. */
export const CODESIGN_TIMEOUT_MS = 30_000;
