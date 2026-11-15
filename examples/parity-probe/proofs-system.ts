/**
 * The filesystem, menu-bar and deep-link proofs: the three surfaces that are a real OS call rather
 * than a window, each printed as one line the harness asserts. macOS allows one status item per
 * process and the runtime already holds it, so the tray proof drives that item, reads AppKit's
 * answer, and puts back the empty title and detached menu it found — the item is on the menu bar
 * for a moment and nothing outlives the run.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createDeepLink, createOsPlugin, createTrayPlugin, fsPlugin } from "crust/plugin";
import {
	createStatusBar,
	currentStatusBar,
	type StatusBar,
} from "../../src/platform/darwin/status-bar.ts";
import config from "./crust.config.ts";
import { mark, reason, skip } from "./proofs.ts";

const ROWS = ["Parity row one", "Parity row two"];
const URL = "probe://open/42?tab=notes";

/** A real temp dir under this app's own data root, plus that root when the probe created it. */
export async function proveFs(): Promise<boolean> {
	const { appData } = createOsPlugin({ appId: config.app.id }).commands.paths();
	const rootExisted = existsSync(appData);
	try {
		mkdirSync(appData, { recursive: true });
	} catch (error) {
		return skip("fs", reason(error));
	}
	const dir = join(appData, `parity-${process.pid}-${Date.now()}`);
	const file = join(dir, "note.txt");
	const moved = join(dir, "moved.txt");
	const text = `crust parity probe ${new Date().toISOString()}\n`;
	try {
		const wrote = await fsPlugin.commands.writeTextFile({ path: file, contents: text });
		const read = await fsPlugin.commands.readTextFile({ path: file });
		const before = await fsPlugin.commands.stat({ path: file });
		const renamed = await fsPlugin.commands.rename({ from: file, to: moved });
		const after = await fsPlugin.commands.stat({ path: moved });
		const removed = await fsPlugin.commands.remove({ path: moved });
		const gone = await fsPlugin.commands.stat({ path: moved }).then(
			() => false,
			() => true,
		);
		const bytes = wrote.bytes;
		console.log(`fs ok ${bytes} bytes at ${before.path}`);
		return mark(
			"fs",
			read === text &&
				before.directory === false &&
				before.size === bytes &&
				renamed.path === after.path &&
				after.size === bytes &&
				removed.removed &&
				gone,
		);
	} finally {
		await fsPlugin.commands.remove({ path: dir, recursive: true }).catch(() => undefined);
		// Non-recursive, so a root the runtime has since filled with real data is left alone.
		if (!rootExisted) await fsPlugin.commands.remove({ path: appData }).catch(() => undefined);
	}
}

type Acquired = { bar: StatusBar; owned: boolean } | { why: string };

/** The runtime's item when it exists, else one this proof created and must destroy. */
function acquire(): Acquired {
	try {
		const runtime = currentStatusBar();
		if (runtime !== undefined) return { bar: runtime, owned: false };
		return { bar: createStatusBar(), owned: true };
	} catch (error) {
		return { why: reason(error) };
	}
}

/** Two rows on a real status item, then AppKit's own title and visibility read back. */
export function proveTray(): boolean {
	const held = acquire();
	if ("why" in held) return skip("tray", held.why);
	const tray = createTrayPlugin(held.bar);
	console.log("tray      a status item sits on the menu bar for a moment, then its rows go");
	try {
		tray.commands.setTitle({ text: "probe" });
		const menu = tray.commands.setMenu({ items: ROWS.map((label) => ({ label })) });
		const shown = tray.commands.show();
		const read = held.bar.readback();
		const labels = (menu as { labels?: readonly string[] }).labels ?? [];
		console.log(`tray items: ${labels.length} visible: ${read.visible}`);
		return mark(
			"tray",
			shown.ok === true && labels.length === ROWS.length && read.visible === true,
		);
	} finally {
		tray.commands.setMenu({ items: [] });
		tray.commands.setTitle({ text: "" });
		if (held.owned) tray.commands.destroy();
	}
}

/**
 * The launch URL through the plugin, read back through the plugin command as well as the object.
 * For a non-special scheme the first segment is the host, so `open` is `host` and `/42` the path.
 */
export function proveDeepLink(): boolean {
	const link = createDeepLink({ scheme: "probe" });
	const target = link.launch(URL);
	if (target === null) {
		console.log("deep-link launch refused the url");
		return mark("deep-link", false);
	}
	const asked = link.plugin.commands.url();
	const { scheme, host, path, query } = target;
	console.log(
		`deep-link ${URL} scheme=${scheme} path=${path} host=${host} query=${new URLSearchParams(query)}`,
	);
	return mark(
		"deep-link",
		link.url() === URL && asked === URL && scheme === "probe" && query.tab === "notes",
	);
}
