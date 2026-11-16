import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DownloadResult, InstallArgs, InstallResult, UpdaterFailure } from "@/plugins/updater";
import {
	bundle,
	executableOf,
	offlineAdapter,
	plugin,
	scratch,
	UPDATE_URL,
	verifiedDownload,
	writing,
} from "@/plugins/updater-fake";

const MARKER = join("Contents", "marker.txt");

describe("updater.install", () => {
	test("renames the verified bundle over this app's own bundle, keeping the old one aside", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "old");
			const source = await bundle(dir, "Notes-new.app", "new");
			const { commands, file } = await verifiedDownload(source, executableOf(appPath));
			expect(await commands.install({ path: file.path, appPath })).toMatchObject({
				ok: true,
				backup: `${appPath}.old`,
			});
			expect(await readFile(join(appPath, MARKER), "utf8")).toBe("new");
			expect(await readFile(join(`${appPath}.old`, MARKER), "utf8")).toBe("old");
			await expect(stat(file.path)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("finding 1: a bundle the page dropped on disk is refused, replacing nothing", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "old");
			const evil = await bundle(dir, "Evil.app", "evil");
			const result = (await plugin(offlineAdapter(), {}, executableOf(appPath)).install({
				path: evil,
				appPath,
			})) as UpdaterFailure;
			expect(result).toMatchObject({ ok: false, code: "unverified-artifact", path: evil });
			expect(result.message).toContain("no updater.download verified it in this run");
			expect(await readFile(join(appPath, MARKER), "utf8")).toBe("old");
			await expect(stat(evil)).resolves.toBeDefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("finding 1: the receipt is this run's, so a fresh plugin refuses it", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "old");
			const source = await bundle(dir, "Notes-new.app", "new");
			const { file } = await verifiedDownload(source, executableOf(appPath));
			const elsewhere = (await plugin(offlineAdapter(), {}, executableOf(appPath)).install({
				path: file.path,
				appPath,
			})) as UpdaterFailure;
			expect(elsewhere).toMatchObject({ ok: false, code: "unverified-artifact" });
			expect(await readFile(join(appPath, MARKER), "utf8")).toBe("old");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("finding 1: an artifact that changed after download is refused, not installed", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "old");
			const source = await bundle(dir, "Notes-new.app", "new");
			const { commands, file } = await verifiedDownload(source, executableOf(appPath));
			await writeFile(join(file.path, MARKER), "swapped", "utf8");
			const result = (await commands.install({ path: file.path, appPath })) as UpdaterFailure;
			expect(result).toMatchObject({ ok: false, code: "hash-mismatch", path: file.path });
			expect(result.message).toContain("changed since download");
			expect(await readFile(join(appPath, MARKER), "utf8")).toBe("old");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a target or a verified download that is not an .app directory replaces nothing", async () => {
		const dir = await scratch();
		try {
			const notAnApp = await bundle(dir, "Notes", "old");
			const target = await bundle(dir, "Other.app", "old");
			const source = await bundle(dir, "Notes-new.app", "new");
			const { commands, file } = await verifiedDownload(source, executableOf(target));
			expect(await commands.install({ path: file.path, appPath: notAnApp })).toMatchObject({
				ok: false,
				code: "not-an-app-bundle",
			});
			const payload = "not a bundle";
			const sha256 = createHash("sha256").update(payload).digest("hex");
			const archive = plugin(writing(payload), {}, executableOf(target));
			const artifact = (await archive.download({
				url: UPDATE_URL,
				sha256,
			})) as DownloadResult;
			expect(await archive.install({ path: artifact.path, appPath: target })).toMatchObject({
				ok: false,
				code: "not-an-app-bundle",
			});
			expect(await readFile(join(notAnApp, MARKER), "utf8")).toBe("old");
			expect(await readFile(join(target, MARKER), "utf8")).toBe("old");
			await expect(stat(file.path)).resolves.toBeDefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("missing arguments are invalid arguments, never a throw", async () => {
		const commands = plugin(offlineAdapter());
		const partial = (await commands.install({
			appPath: "/Applications/Notes.app",
		} as InstallArgs)) as UpdaterFailure;
		expect(partial).toMatchObject({ ok: false, code: "invalid-arguments" });
		const empty = (await commands.install({} as InstallArgs)) as InstallResult;
		expect(empty).toMatchObject({ ok: false, code: "invalid-arguments" });
	});
});
