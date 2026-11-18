/**
 * The dialog, opener and OS proofs. A picker sheet needs a person, so the dialog proof takes the
 * two answers the plugin gives without one — the typed refusal and the real adapter's idle cancel —
 * and never puts a panel on screen.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createDialogPlugin, createOpenerPlugin, createOsPlugin } from "crust/plugin";
import { darwinDialogAdapter } from "../../src/platform/darwin/dialog.ts";
import { darwinOpenerAdapter } from "../../src/platform/darwin/opener.ts";
import { darwinOsAdapter } from "../../src/platform/darwin/os-info.ts";
import { darwinPanelShim } from "../../src/platform/darwin/panel-shim.ts";
import { PANEL_KIND } from "../../src/platform/darwin/panel-status.ts";
import config from "./crust.config.ts";
import { mark, reason, skip } from "./proofs.ts";

/** The shipped registration has no adapter, so it must name the selector it waits on. */
export async function proveDialog(): Promise<boolean> {
	const refusal = (await createDialogPlugin().commands.openPanel({})) as {
		ok?: boolean;
		code?: string;
		requires?: string;
	};
	const typed =
		refusal.ok === false &&
		refusal.code === "not-implemented" &&
		typeof refusal.requires === "string";
	const idle = (await createDialogPlugin(darwinDialogAdapter()).commands.cancel()) as {
		cancelled?: unknown;
		paths?: unknown;
	};
	const count = Array.isArray(idle.paths) ? idle.paths.length : -1;
	const noSheet = darwinPanelShim().sheetKind() === PANEL_KIND.none;
	console.log(
		`dialog    refused: ${String(refusal.code)} (${String(refusal.requires)}), ` +
			`cancel with no sheet: cancelled=${String(idle.cancelled)} paths=${count}`,
	);
	return mark("dialog", typed && idle.cancelled === false && count === 0 && noSheet);
}

/** A reveal selects the file in Finder: allowed, and the one visible thing this proof does. */
export async function proveOpener(): Promise<boolean> {
	const { appData } = createOsPlugin({
		...darwinOsAdapter(),
		appId: config.app.id,
	}).commands.paths();
	const dir = join(appData, `parity-opener-${process.pid}-${Date.now()}`);
	const file = join(dir, "reveal-me.txt");
	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(file, `crust parity probe ${new Date().toISOString()}\n`, "utf8");
	} catch (error) {
		return skip("opener", reason(error));
	}
	try {
		const answer = (await createOpenerPlugin(darwinOpenerAdapter()).commands.revealItem({
			path: file,
		})) as { ok?: boolean; revealed?: unknown; path?: unknown };
		if (answer.ok !== true || answer.revealed !== true || answer.path !== file) {
			console.log(`opener    reveal refused: ${JSON.stringify(answer)}`);
			return mark("opener", false);
		}
		console.log(`opener    revealed ${file} — Finder selected it, nothing was opened`);
		return mark("opener", true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** `appLog` sits under `appData` by the same `logDirs` the sink writes through. */
export async function proveOs(): Promise<boolean> {
	const plugin = createOsPlugin({ ...darwinOsAdapter(), appId: config.app.id });
	const info = (await plugin.commands.info()) as {
		ok?: boolean;
		platform?: string;
		arch?: string;
		family?: string;
		version?: string;
	};
	const paths = plugin.commands.paths();
	console.log(
		`os        ${String(info.platform)} ${String(info.arch)} ${String(info.version)} ` +
			`family=${String(info.family)}`,
	);
	const root = join(homedir(), "Library", "Application Support", config.app.id);
	const inside = isAbsolute(paths.appLog) && paths.appLog.startsWith(`${paths.appData}/`);
	return mark(
		"os",
		info.ok === true &&
			info.platform === "darwin" &&
			typeof info.arch === "string" &&
			info.arch.length > 0 &&
			info.family === "macOS" &&
			/^\d+\.\d+/.test(String(info.version)) &&
			paths.appData === root &&
			inside,
	);
}
