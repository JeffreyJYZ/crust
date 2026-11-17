/**
 * One pattern per probe proof, kept apart from the harness so the run reads as a run.
 *
 * A line proves its surface or it proves nothing. A "not available" form is never
 * a passing proof: the probe marks that surface false, so a green line here never
 * overstates what ran. A surface that cannot run fails the parity e2e by design.
 */
export const MENU = /^menu\s+titles: .*"Probe item".*$/m;
export const CLIPBOARD = /^clipboard png \d+ bytes, first 8 89 50 4e 47 0d 0a 1a 0a$/m;
export const RESTORED = /^clipboard restored: true$/m;
export const CHROME = /^chrome\s+opacity 0\.75, decorations false$/m;
export const SHORTCUT = /^shortcut\s+emitted: command\+shift\+k$/m;
/** A posted chord is answered by the window server or it is not; both are honest. */
export const KEYPRESS = /^shortcut-press (delivered: .+|not delivered: .+)$/m;
/** Only the verified path passes: a signed download, a swap it authorised, and the receipt refusal. */
export const UPDATER = /^updater\s+signed=true swapped=true unverified=refused$/m;
export const NOTIFICATION = /^notification (delivered: .+|refused: .+)$/m;
export const FS = /^fs ok \d+ bytes at .*Application Support\/land\.jyz\.parity-probe\/.*$/m;
export const TRAY = /^tray items: 2 visible: true$/m;
export const SHELL = /^shell echo: hi$/m;
export const SHELL_REFUSED = /^shell refused: program-not-allowed$/m;
export const STORE = /^store k=\{"n":1\} persisted=true$/m;
export const DIALOG =
	/^dialog\s+refused: not-implemented \(NSOpenPanel\), cancel with no sheet: cancelled=false paths=0$/m;
export const OPENER =
	/^opener\s+revealed .*reveal-me\.txt — Finder selected it, nothing was opened$/m;
export const OS = /^os\s+darwin arm64 \d+\.\d+\.\d+ family=macOS$/m;
export const STRONGHOLD = /^stronghold encrypted=true bad-password=true$/m;
export const AUTOSTART = /^autostart plist=written enabled=true removed=true$/m;
export const LOGGING = /^logging rotated=true lines=\d+$/m;
export const WINDOW_STATE = /^window-state saved=\[".*"\] restored=true$/m;
export const POSITIONER = /^positioner center=\d+,\d+ corners=ok$/m;
/**
 * The appearance round trip has to move and come back, and both `set`/`reset` have to emit,
 * so a cached field cannot pass this line.
 */
export const THEME =
	/^theme\s+(light|dark) source=(system|override) set=(light|dark) reset=(light|dark) events=[1-9]\d*$/m;
export const I18N = /^i18n\s+locale=\S+ greeting="hello crust" plural="one file"\/"7 files"$/m;
export const DEEP_LINK =
	/^deep-link probe:\/\/open\/42\?tab=notes scheme=probe path=\/42 host=open query=tab=notes$/m;
/** The badge round trip: set, read back, cleared, read back empty. */
export const DOCK = /^dock\s+badge="[^"]+" read="[^"]+" cleared=true$/m;
export const POWER = /^power\s+ac=(true|false) battery=(none|\d+) idle=\d+s$/m;
/**
 * The external read is the measurement: a separate trusted process has to see the app's own window,
 * and an empty external read is a real negative that the line names. A helper that could not run
 * names why instead. Both forms are accepted here; the probe's own mark decides PASS or FAIL.
 */
export const ACCESSIBILITY =
	/^accessibility ax self=(none|\d+) external=(windows:-?\d+,children:-?\d+,status:-?\d+( — the app does not expose its window to other processes)?|refused: \S.*)$/m;
export const NAVIGATION = /^navigation finished=true url=data:.*$/m;
export const FINDINPAGE = /^findinpage found=true matches=1$/m;
export const NETWORK = /^network\s+rules=1 blocked=true$/m;
export const DOWNLOADS = /^downloads dir=inside cancel=refused$/m;
/** A running guard proves `last`; a guard a bundle cannot spawn must name why, and that is a pass. */
export const CRASH = /^crash\s+guard=(running last=none|refused last=unknown — .+)$/m;
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
	["theme", THEME],
	["i18n", I18N],
	["dock", DOCK],
	["power", POWER],
	["accessibility", ACCESSIBILITY],
	["navigation", NAVIGATION],
	["findinpage", FINDINPAGE],
	["network", NETWORK],
	["downloads", DOWNLOADS],
	["crash-reporter", CRASH],
] as const;
