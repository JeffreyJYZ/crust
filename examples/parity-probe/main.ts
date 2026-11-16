/**
 * The runtime parity probe: nine surfaces the matrix used to mark "same" on compile evidence
 * alone, each proved by a real round trip and printed as one line, then one `parity:` summary.
 * It opens a 1x1 shell window for the runtime plus one 240x160 probe window, and both are gone
 * before it exits. The proofs live in the `proofs-*.ts` files beside this one; this file owns the
 * run and the verdict.
 */
import { app } from "crust";
import { attempt, proofs, proveClipboard, proveMenu } from "./proofs.ts";
import { proveDeepLink, proveFs, proveTray } from "./proofs-system.ts";
import { proveShell, proveStore, proveStronghold } from "./proofs-data.ts";
import { proveDialog, proveOpener, proveOs } from "./proofs-io.ts";
import { proveAutostart, proveLogging, provePositioner, proveWindowState } from "./proofs-state.ts";
import { proveNotification, proveUpdater } from "./proofs-update.ts";
import { proveChrome, proveShortcut } from "./proofs-window.ts";
import { proveI18n, proveTheme } from "./proofs-locale.ts";
import { proveKeyPress } from "./proofs-keypress.ts";
import { proveAccessibility, proveDock, provePower } from "./proofs-native.ts";
import { proveFindInPage, proveNavigation } from "./proofs-webview.ts";
import { proveCrashReporter, proveDownloads, proveNetwork } from "./proofs-connect.ts";

async function main(): Promise<void> {
	await app.run();
	console.log("main-marker v2");
	console.log("windows   a 1x1 runtime shell plus one 240x160 probe window, closed before exit");
	await attempt("menu", proveMenu);
	await attempt("clipboard", proveClipboard);
	await attempt("chrome", proveChrome);
	await attempt("shortcut", proveShortcut);
	await attempt("shortcut-press", proveKeyPress);
	await attempt("theme", proveTheme);
	await attempt("i18n", proveI18n);
	await attempt("updater", proveUpdater);
	await attempt("notification", proveNotification);
	await attempt("fs", proveFs);
	await attempt("tray", proveTray);
	await attempt("deep-link", proveDeepLink);
	await attempt("shell", proveShell);
	await attempt("store", proveStore);
	await attempt("stronghold", proveStronghold);
	await attempt("dialog", proveDialog);
	await attempt("opener", proveOpener);
	await attempt("os", proveOs);
	await attempt("autostart", proveAutostart);
	await attempt("logging", proveLogging);
	await attempt("window-state", proveWindowState);
	await attempt("positioner", provePositioner);
	await attempt("dock", proveDock);
	await attempt("power", provePower);
	await attempt("accessibility", proveAccessibility);
	await attempt("navigation", proveNavigation);
	await attempt("findinpage", proveFindInPage);
	await attempt("network", proveNetwork);
	await attempt("downloads", proveDownloads);
	await attempt("crash-reporter", proveCrashReporter);
	const passed = proofs.filter((proof) => proof.ok).length;
	const verdict = passed === proofs.length ? "PASS" : "FAIL";
	console.log(`parity: ${verdict} ${passed}/${proofs.length}`);
	process.exit(verdict === "PASS" ? 0 : 1);
}

main().catch((error: unknown) => {
	const why = error instanceof Error ? error.message : String(error);
	console.log(`parity: FAIL 0/0 — ${why}`);
	process.exit(1);
});
