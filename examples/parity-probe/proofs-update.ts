/**
 * The updater and notification proofs: the two surfaces whose runtime evidence was unit tests alone.
 * The swap runs on real temp bundles through the default `node:fs` adapter, so nothing is faked; the
 * notification proof asks the real OS and reports its answer, and a refusal is the proof, not a miss.
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNotificationPlugin, createUpdaterPlugin } from "crust/plugin";
import { darwinNotificationAdapter } from "../../src/platform/darwin/notifications.ts";
import { mark } from "./proofs.ts";

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleName</key><string>Parity probe</string></dict></plist>`;

const NEW_MARKER = "new-bundle-marker";
const OLD_MARKER = "old-bundle-marker";

/** A real `.app` on disk: the directory plus an `Info.plist`, which is all a bundle is. */
async function bundle(parent: string, name: string, marker: string): Promise<string> {
	const path = join(parent, `${name}.app`);
	await mkdir(join(path, "Contents"), { recursive: true });
	await writeFile(join(path, "Contents", "Info.plist"), PLIST, "utf8");
	await writeFile(join(path, "marker.txt"), marker, "utf8");
	return path;
}

/** An unavailable surface is not a pass, so it records nothing: the summary counts only what ran. */
function skipped(name: string, why: string): boolean {
	console.log(`${name.padEnd(9)} unavailable — ${why}`);
	return true;
}

/**
 * `install` renames the old bundle to `<appPath>.old` and the new one into place; a marker inside
 * the new bundle read back at the app path is what proves the swap rather than a stray rename.
 */
export async function proveUpdater(): Promise<boolean> {
	const root = await mkdtemp(join(tmpdir(), "crust-parity-update-"));
	try {
		const appPath = await bundle(root, "Old", OLD_MARKER);
		const fresh = await bundle(root, "New", NEW_MARKER);
		const answer = await createUpdaterPlugin().commands.install({ path: fresh, appPath });
		if (answer.ok !== true) {
			console.log(`updater   install refused: ${JSON.stringify(answer)}`);
			return mark("updater", false);
		}
		const parked = await stat(`${appPath}.old`).catch(() => undefined);
		const installed = await readFile(join(appPath, "marker.txt"), "utf8").catch(() => "");
		const previous = await readFile(join(`${appPath}.old`, "marker.txt"), "utf8").catch(
			() => "",
		);
		const swapped =
			parked?.isDirectory() === true && installed === NEW_MARKER && previous === OLD_MARKER;
		if (!swapped) {
			console.log(
				`updater   swap wrong: .old holds ${previous || "nothing"}, app holds ${installed || "nothing"}`,
			);
			return mark("updater", false);
		}
		console.log("updater swapped old->.old new->app");
		return mark("updater", true);
	} finally {
		await rm(root, { recursive: true, force: true }).catch(() => undefined);
	}
}

/**
 * `waitMs: 0` asks the OS without waiting: a first post raises the permission prompt and nothing is
 * delivered until a person answers, so a probe that waited would hang instead of reporting. A banner
 * may appear once; the proof is the OS's answer, never the banner.
 */
export async function proveNotification(): Promise<boolean> {
	const plugin = createNotificationPlugin(darwinNotificationAdapter());
	const answer = (await plugin.commands.notify({
		title: "crust parity probe",
		body: "the OS answer is the proof, not this banner",
		waitMs: 0,
	})) as { delivered?: unknown; reason?: unknown; code?: unknown };
	if (typeof answer.delivered !== "boolean") {
		return skipped("notification", JSON.stringify(answer));
	}
	const reason = typeof answer.reason === "string" ? answer.reason : "no reason recorded";
	if (answer.delivered) {
		console.log(`notification delivered: ${reason}`);
		return mark("notification", true);
	}
	console.log(`notification refused: ${reason}`);
	return mark("notification", true);
}
