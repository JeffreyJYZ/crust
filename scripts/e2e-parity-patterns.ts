/**
 * One pattern per probe proof, kept apart from the harness so the run reads as a run.
 *
 * Each accepts the honest "not available in this tree" form as well as the proved
 * form, because the probe must still pass the surfaces that exist; the exit code
 * carries the verdict, so a green line here never overstates what ran.
 */
export const MENU = /^menu\s+(titles: .*"Probe item".*|read unavailable.*)$/m;
export const CLIPBOARD = /^clipboard png \d+ bytes, first 8 89 50 4e 47 0d 0a 1a 0a$/m;
export const RESTORED = /^clipboard restored: true$/m;
export const CHROME = /^chrome\s+opacity 0\.75, decorations false$/m;
export const SHORTCUT = /^shortcut\s+(emitted: command\+shift\+k|seam unavailable.*)$/m;
/** A posted chord is answered by the window server or it is not; both are honest. */
export const KEYPRESS = /^shortcut-press (delivered: .+|not delivered: .+)$/m;
/** The swap is deterministic, so only the proved line passes; a notification may refuse. */
export const UPDATER = /^updater swapped old->\.old new->app$/m;
export const NOTIFICATION = /^notification (delivered: .+|refused: .+)$/m;
export const FS = /^fs ok \d+ bytes at .*Application Support\/land\.jyz\.parity-probe\/.*$/m;
export const TRAY = /^tray items: 2 visible: true$/m;
export const SHELL = /^shell echo: hi$/m;
export const SHELL_REFUSED = /^shell refused: program-not-allowed$/m;
export const STORE = /^store k=\{"n":1\} persisted=true$/m;
export const DIALOG =
	/^dialog\s+refused: not-implemented \(NSOpenPanel\), cancel with no sheet: cancelled=false paths=0$/m;
export const OPENER = /^opener\s+revealed .*reveal-me\.txt — Finder selected it, nothing was opened$/m;
export const OS = /^os\s+darwin arm64 \d+\.\d+\.\d+ family=macOS$/m;
export const STRONGHOLD = /^stronghold encrypted=true bad-password=true$/m;
export const AUTOSTART = /^autostart plist=written enabled=true removed=true$/m;
export const LOGGING = /^logging rotated=true lines=\d+$/m;
export const WINDOW_STATE = /^window-state saved=\[".*"\] restored=true$/m;
export const POSITIONER = /^positioner center=\d+,\d+ corners=ok$/m;
export const DEEP_LINK =
	/^deep-link probe:\/\/open\/42\?tab=notes scheme=probe path=\/42 host=open query=tab=notes$/m;
export const SUMMARY = /^parity: (PASS|FAIL) \d+\/\d+$/m;

/** Every proof the harness asserts, in the order the probe runs them. */
export const PATTERNS = [
	["menu", MENU],
	["clipboard", CLIPBOARD],
	["chrome", CHROME],
	["shortcut", SHORTCUT],
	["shortcut-press", KEYPRESS],
	["updater", UPDATER],
	["notification", NOTIFICATION],
	["fs", FS],
	["tray", TRAY],
	["deep-link", DEEP_LINK],
	["shell", SHELL],
	["shell-refused", SHELL_REFUSED],
	["store", STORE],
	["stronghold", STRONGHOLD],
	["dialog", DIALOG],
	["opener", OPENER],
	["os", OS],
	["autostart", AUTOSTART],
	["logging", LOGGING],
	["window-state", WINDOW_STATE],
	["positioner", POSITIONER],
] as const;
