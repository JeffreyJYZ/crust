/**
 * Helpers and skip constants for the live Butter sweep, split out of `butter-sweep-commands.ts`
 * for the 200-line cap. The case table itself — every case and every skip reason — stays in
 * `butter-sweep-commands.ts`; this file holds only the shapes and values the table names.
 */

export interface SweepCase {
	/** `plugin.command`, exactly as a page would invoke it. */
	command: string;
	/** Arguments, or undefined for a command that takes none. */
	args?: unknown;
	/**
	 * The window label the bridge would attach to this request. `window.label` is the one command
	 * whose whole answer *is* that label, so it needs one or it refuses for a reason that says so.
	 */
	window?: string;
	/** Set only when the command must not be driven; the text is why. */
	skip?: string;
}

export const NO_PERSON =
	"needs a person in front of the machine (a permission prompt or a system dialog), so a runner " +
	"cannot answer it; the plugin suite covers its refusal path instead";

/**
 * The other skip reasons, named so the case table stays one line per case. The text is unchanged:
 * each reason is a decision about what a runner must not do on a person's machine.
 */
export const NOTIFICATION_PERMISSION =
	"by design the notification itself raises the prompt, so this command refuses on purpose and always";
export const OPENER_URL = "launches the default browser, which a headless runner must not do";
export const OPENER_REVEAL =
	"opens a Finder window and steals focus from the person using the machine";
export const OPENER_PATH = "hands a path to LaunchServices, which may open any registered app";
export const UPDATER_INSTALL =
	"replaces the running bundle on disk, which would leave the sweep swapping its own app";
export const UPDATER_RELAUNCH =
	"re-executes the app, which kills the test runner before it can report";
export const MENU_CONTEXT = "opens a modal context menu that blocks until a person dismisses it";
export const DOWNLOADS_START =
	"starts a real network download into the app data root, which a runner must not touch";
export const SINGLE_INSTANCE =
	"the runtime claims this lock at launch and the runner holds it; a release here would free the harness's own claim";
export const AUTOSTART_ENABLE =
	"writes a RunAtLoad plist into the user's real ~/Library/LaunchAgents, which would add a login item on this machine; e2e:parity proves the write against a temp home";

/** Where the sweep writes its i18n catalogue; the runner creates it beside the case table. */
export const LOCALES_DIR = ".sweep-tmp/locales";

/**
 * `clipboard.writeImage` takes real bytes, and a JSON case table cannot carry a Uint8Array — so a
 * case names this marker and the child substitutes a 1×1 transparent PNG. The smallest real PNG is
 * what makes the write a pasteboard write rather than a shape check.
 */
export const PNG_MARKER = "sweep-png";

/**
 * An obscure hot key, registered then released by the sweep so no combination a person uses is
 * swallowed. `f19` with three modifiers is outside every common binding.
 */
export const SWEEP_SHORTCUT = "control+option+shift+f19";

/**
 * A bundle id that cannot own a real LaunchAgent, so the two safe autostart commands (a read and a
 * forced removal) touch no login item on the machine running the sweep.
 */
export const SWEEP_BUNDLE_ID = "dev.crust.sweep.probe.absent";
