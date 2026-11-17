/**
 * The command table the live Butter sweep drives: one entry per Butter-mapped command, with the
 * arguments a headless runner can pass. A command that cannot be driven here carries a written
 * reason and is asserted to be skipped for that reason, so an exclusion is a decision somebody made
 * rather than a silent hole.
 *
 * Split from `butter-sweep.test.ts` for the 200-line cap, and because the table is data: the runner
 * reads it, the test asserts it covers every command the plugins expose.
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

const NO_PERSON =
	"needs a person in front of the machine (a permission prompt or a system dialog), so a runner " +
	"cannot answer it; the plugin suite covers its refusal path instead";

/** Where the sweep writes its i18n catalogue; the runner creates it beside the case table. */
export const LOCALES_DIR = ".sweep-tmp/locales";

export const SWEEP: readonly SweepCase[] = [
	// fs — every path inside a temp dir the runner owns.
	{ command: "fs.writeTextFile", args: { path: ".sweep-tmp/sweep.txt", contents: "sweep" } },
	{ command: "fs.readTextFile", args: { path: ".sweep-tmp/sweep.txt" } },
	{ command: "fs.writeBinary", args: { path: ".sweep-tmp/sweep.bin", bytes: [1, 2, 3] } },
	{ command: "fs.readBinary", args: { path: ".sweep-tmp/sweep.bin" } },
	{ command: "fs.stat", args: { path: ".sweep-tmp/sweep.txt" } },
	{ command: "fs.list", args: { path: ".sweep-tmp" } },
	{ command: "fs.mkdir", args: { path: ".sweep-tmp/sweepdir" } },
	{ command: "fs.rename", args: { from: ".sweep-tmp/sweep.bin", to: ".sweep-tmp/sweep2.bin" } },
	{ command: "fs.remove", args: { path: ".sweep-tmp/sweep2.bin" } },
	{ command: "fs.scopeList", args: {} },

	// clipboard — text round trip, then the image read (the PNG write is covered separately).
	{ command: "clipboard.write", args: { text: "sweep" } },
	{ command: "clipboard.read", args: {} },
	{ command: "clipboard.readImage", args: {} },

	// store, stronghold, keychain — all three own a file or an OS entry; `delete` runs after.
	{ command: "store.set", args: { key: "k", value: 1 } },
	{ command: "store.get", args: { key: "k" } },
	{ command: "store.keys", args: {} },
	{ command: "store.delete", args: { key: "k" } },
	{ command: "store.save", args: {} },
	{ command: "store.clear", args: {} },
	{ command: "stronghold.open", args: { password: "sweep-password" } },
	{ command: "stronghold.set", args: { key: "k", value: "v" } },
	{ command: "stronghold.get", args: { key: "k" } },
	{ command: "stronghold.keys", args: {} },
	{ command: "stronghold.delete", args: { key: "k" } },
	{ command: "stronghold.close", args: {} },
	{ command: "keychain.set", args: { service: "crust.sweep", account: "k", secret: "v" } },
	{ command: "keychain.get", args: { service: "crust.sweep", account: "k" } },
	{ command: "keychain.list", args: { service: "crust.sweep" } },
	{ command: "keychain.delete", args: { service: "crust.sweep", account: "k" } },

	// network — the interceptor's own state plus the connectivity read.
	{ command: "network.rules", args: {} },
	{ command: "network.setRules", args: { rules: [] } },
	{ command: "network.log", args: {} },
	{ command: "network.clearLog", args: {} },
	{ command: "network.status", args: {} },

	// power — the reads and the assertion pair; `sleepAllow` releases what `sleepPrevent` took.
	{ command: "power.state", args: {} },
	{ command: "power.idleSeconds", args: {} },

	// screen, theme, dock, i18n, logging — pure reads or reversible writes.
	{ command: "screen.list", args: {} },
	{ command: "screen.primary", args: {} },
	{ command: "theme.current", args: {} },
	{ command: "theme.set", args: { theme: "system" } },
	{ command: "theme.reset", args: {} },
	{ command: "dock.badgeLabel", args: {} },
	{ command: "dock.badge", args: { text: "s" } },
	// i18n — the catalogue is the app's to supply, so the sweep loads one first and then reads it.
	// Without that every i18n command answers `not-implemented`, which is accurate and not a gap.
	{ command: "i18n.load", args: { directory: LOCALES_DIR } },
	{ command: "i18n.locale", args: {} },
	{ command: "i18n.messages", args: {} },
	{ command: "i18n.translate", args: { key: "sweep" } },
	{ command: "logging.level", args: {} },
	{ command: "logging.setLevel", args: { level: "info" } },
	{ command: "logging.write", args: { level: "info", message: "sweep" } },
	{ command: "logging.tail", args: {} },

	// database — a file in the temp dir; open, one statement, one read, close.
	{ command: "database.open", args: { name: "sweep" } },
	{ command: "database.exec", args: { handle: "sweep", sql: "CREATE TABLE IF NOT EXISTS t (v)" } },
	{ command: "database.query", args: { handle: "sweep", sql: "SELECT 1" } },
	{ command: "database.get", args: { handle: "sweep", sql: "SELECT 1" } },
	{ command: "database.close", args: { handle: "sweep" } },

	// crash-reporter — the page-facing report and the reads it feeds.
	{ command: "crash-reporter.report", args: { message: "sweep" } },
	{ command: "crash-reporter.last", args: {} },
	{ command: "crash-reporter.list", args: {} },
	{ command: "crash-reporter.clear", args: {} },

	// accessibility — the page-facing trio plus the trust read.
	{ command: "accessibility.trusted", args: {} },
	{ command: "accessibility.elementCount", args: {} },
	{ command: "accessibility.announce", args: { text: "sweep" } },
	{ command: "accessibility.title", args: { text: "sweep" } },

	// os, deep-link, single-instance, sidecar, menu, window-state, tray.
	{ command: "os.info", args: {} },
	{ command: "os.paths", args: {} },
	{ command: "os.locale", args: {} },
	{ command: "deep-link.url", args: {} },
	{ command: "single-instance.release", args: { id: "crust.sweep" }, skip: "the runtime claims this lock at launch and the runner holds it; a release here would free the harness's own claim" },
	{ command: "sidecar.list", args: {} },
	{ command: "menu.isDefault", args: {} },
	{ command: "menu.read", args: {} },
	{ command: "window-state.save", args: { label: "sweep" } },
	{ command: "window-state.restore", args: { label: "sweep" } },
	{ command: "window-state.forget", args: { label: "sweep" } },
	{ command: "tray.setTitle", args: { text: "sweep" } },
	{ command: "tray.setTooltip", args: { text: "hover" } },
	{ command: "tray.show", args: {} },
	{ command: "tray.hide", args: {} },

	// navigation, find, downloads, positioner, window — all need the live window.
	{ command: "navigation.start", args: {} },
	{ command: "navigation.state", args: {} },
	{ command: "navigation.loadUrl", args: { url: "about:blank?native=proof" } },
	{ command: "navigation.reload", args: {} },
	{ command: "navigation.stop", args: {} },
	{ command: "findinpage.search", args: { text: "sweep" } },
	{ command: "findinpage.previous", args: {} },
	{ command: "downloads.list", args: {} },
	{ command: "downloads.directory", args: {} },
	{ command: "positioner.center", args: { label: "main" } },
	{ command: "window.list", args: {} },
	{ command: "window.isOpen", args: { label: "main" } },
	// `window.label` answers the label the *invoke* carried, and a direct handler call carries none —
	// the bridge adds it from the request. Its refusal text says exactly that, so it is driven with a
	// context that names a window rather than skipped.
	{ command: "window.label", args: {}, window: "main" },

	// --- skipped, each with the reason a runner cannot act ---
	{ command: "dialog.openPanel", skip: NO_PERSON },
	{ command: "dialog.savePanel", skip: NO_PERSON },
	{ command: "notification.notify", skip: NO_PERSON },
	{ command: "notification.requestPermission", skip: "by design the notification itself raises the prompt, so this command refuses on purpose and always" },
	{ command: "accessibility.prompt", skip: NO_PERSON },
	{ command: "opener.openUrl", skip: "launches the default browser, which a headless runner must not do" },
	{ command: "opener.revealItem", skip: "opens a Finder window and steals focus from the person using the machine" },
	{ command: "opener.openPath", skip: "hands a path to LaunchServices, which may open any registered app" },
	{ command: "shell.spawn", skip: "runs a program; the shell suite drives a real child against an allowlist" },
	{ command: "sidecar.spawn", skip: "needs a binary copied into the bundle; the sidecar suite drives a real child" },
	{ command: "crash-reporter.install", skip: "arms signal handlers that would take the test runner down with them" },
	{ command: "crash-reporter.uninstall", skip: "disarms the signal handlers that crash-reporter.install would arm, and this sweep never arms them" },
	{ command: "updater.install", skip: "replaces the running bundle on disk, which would leave the sweep swapping its own app" },
	{ command: "updater.relaunch", skip: "re-executes the app, which kills the test runner before it can report" },
	{ command: "menu.showContext", skip: "opens a modal context menu that blocks until a person dismisses it" },
	{ command: "downloads.start", skip: "starts a real network download into the app data root, which a runner must not touch" },
	{ command: "tray.destroy", skip: "removes the status item every later tray command in this sweep needs, so it runs last or not at all" },
	{ command: "clipboard.writeImage", skip: "writes the real pasteboard image; the clipboard suite owns that round trip" },
];
