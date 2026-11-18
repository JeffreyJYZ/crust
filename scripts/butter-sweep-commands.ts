/**
 * The command table the live Butter sweep drives: one entry per Butter-mapped command, with the
 * arguments a headless runner can pass. A command that cannot be driven here carries a written
 * reason and is asserted to be skipped for that reason, so an exclusion is a decision somebody made
 * rather than a silent hole.
 *
 * The shapes and skip constants live in `butter-sweep-helpers.ts`; the runner reads this table and
 * the test asserts it covers every command the plugins expose.
 */
import {
	AUTOSTART_ENABLE,
	DB_HANDLE_MARKER,
	DOWNLOADS_START,
	LOCALES_DIR,
	MENU_CONTEXT,
	NO_PERSON,
	NOTIFICATION_PERMISSION,
	OPENER_PATH,
	OPENER_REVEAL,
	OPENER_URL,
	PNG_MARKER,
	SINGLE_INSTANCE,
	SWEEP_BUNDLE_ID,
	SWEEP_SHORTCUT,
	UPDATER_INSTALL,
	UPDATER_RELAUNCH,
	type SweepCase,
} from "./butter-sweep-helpers.ts";

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

	// database — a file in the temp dir; open, one statement, one read, close. The handle is the one
	// open returned, not the file name: naming "sweep" answers unknown-handle and proves no SQL.
	{ command: "database.open", args: { name: "sweep" } },
	{
		command: "database.exec",
		args: { handle: { __handle: DB_HANDLE_MARKER }, sql: "CREATE TABLE IF NOT EXISTS t (v)" },
	},
	{
		command: "database.query",
		args: { handle: { __handle: DB_HANDLE_MARKER }, sql: "SELECT 1" },
	},
	{ command: "database.get", args: { handle: { __handle: DB_HANDLE_MARKER }, sql: "SELECT 1" } },
	{ command: "database.close", args: { handle: { __handle: DB_HANDLE_MARKER } } },

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
	{ command: "sidecar.list", args: {} },
	{ command: "menu.isDefault", args: {} },
	{ command: "menu.read", args: {} },
	// window-state resolves the label against the platform's real windows ("main", created in the
	// child), so a made-up "sweep" answers unknown-window before any frame is read or written.
	{ command: "window-state.save", args: { label: "main" } },
	{ command: "window-state.restore", args: { label: "main" } },
	{ command: "window-state.forget", args: { label: "main" } },
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

	// shell — a real child, allowlisted to a harmless program by the child's own config, so the
	// command runs rather than refusing.
	{ command: "shell.spawn", args: { program: "sh", args: ["-c", "echo sweep"] } },
	{ command: "shell.list", args: {} },
	// sidecar — the runner writes a shell script into the bundle dir first, so `spawn` has a declared name.
	{ command: "sidecar.spawn", args: { name: "sweep.sh", args: [] } },
	{ command: "sidecar.list", args: {} },
	// clipboard image — a real 1×1 PNG through the real pasteboard, then read back.
	{ command: "clipboard.writeImage", args: { png: { __bytes: "sweep-png" } } },

	// shortcut — a real Carbon hot key on the darwin adapter, registered then released. Order matters:
	// isRegistered and list read what register took; unregister and unregisterAll give it back.
	{ command: "shortcut.register", args: { accelerator: SWEEP_SHORTCUT } },
	{ command: "shortcut.isRegistered", args: { accelerator: SWEEP_SHORTCUT } },
	{ command: "shortcut.list", args: {} },
	{ command: "shortcut.unregister", args: { accelerator: SWEEP_SHORTCUT } },
	{ command: "shortcut.unregisterAll", args: {} },

	// autostart — only the two commands that cannot add a login item. A sweep-only bundle id makes
	// the read answer false and the removal a no-op, so neither touches the person's LaunchAgents.
	{ command: "autostart.isEnabled", args: { bundleId: SWEEP_BUNDLE_ID } },
	{ command: "autostart.disable", args: { bundleId: SWEEP_BUNDLE_ID } },

	// tray.destroy runs last: it removes the item every earlier tray command needed.
	{ command: "tray.destroy", args: {} },

	// --- skipped, each with the reason a runner cannot act ---
	{ command: "dialog.openPanel", skip: NO_PERSON },
	{ command: "dialog.savePanel", skip: NO_PERSON },
	{ command: "notification.notify", skip: NO_PERSON },
	{ command: "notification.requestPermission", skip: NOTIFICATION_PERMISSION },
	{ command: "accessibility.prompt", skip: NO_PERSON },
	{ command: "opener.openUrl", skip: OPENER_URL },
	{ command: "opener.revealItem", skip: OPENER_REVEAL },
	{ command: "opener.openPath", skip: OPENER_PATH },
	{ command: "updater.install", skip: UPDATER_INSTALL },
	{ command: "updater.relaunch", skip: UPDATER_RELAUNCH },
	{ command: "menu.showContext", skip: MENU_CONTEXT },
	{ command: "downloads.start", skip: DOWNLOADS_START },
	{ command: "single-instance.release", skip: SINGLE_INSTANCE },
	{ command: "autostart.enable", skip: AUTOSTART_ENABLE },
];
