/**
 * The destination half of finding 1: a receipt proves the bytes, and this proves the target. A page
 * that holds a genuinely verified artifact must still not be able to rename it over another app.
 */

import { describe, expect, test } from "bun:test";
import { readFile, realpath, rm, stat, symlink } from "node:fs/promises";
import { join } from "node:path";

import type { UpdaterFailure } from "@/plugins/updater";
import { bundle, executableOf, scratch, verifiedDownload } from "@/plugins/updater-fake";

const MARKER = join("Contents", "marker.txt");

describe("updater.install, this app's bundle only", () => {
	test("finding 1: a verified artifact cannot be renamed over a foreign app", async () => {
		const dir = await scratch();
		try {
			const own = await bundle(dir, "Notes.app", "old");
			const foreign = await bundle(dir, "Other.app", "other");
			const source = await bundle(dir, "Notes-new.app", "new");
			const { commands, file } = await verifiedDownload(source, executableOf(own));
			const refused = (await commands.install({
				path: file.path,
				appPath: foreign,
			})) as UpdaterFailure;
			expect(refused).toMatchObject({ ok: false, code: "not-an-app-bundle", path: foreign });
			// Both paths are named: the one refused, and the only one install replaces.
			expect(refused.message).toContain(foreign);
			expect(refused.message).toContain(`install only replaces ${await realpath(own)}`);
			expect(await readFile(join(foreign, MARKER), "utf8")).toBe("other");
			expect(await readFile(join(own, MARKER), "utf8")).toBe("old");
			await expect(stat(file.path)).resolves.toBeDefined();
			await expect(stat(`${foreign}.old`)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("finding 1: a dev run refuses every install rather than guessing", async () => {
		const dir = await scratch();
		try {
			const own = await bundle(dir, "Notes.app", "old");
			const source = await bundle(dir, "Notes-new.app", "new");
			// The interpreter running this test is not inside an `.app`, so nothing is its own bundle.
			const { commands, file } = await verifiedDownload(source, process.execPath);
			const refused = (await commands.install({
				path: file.path,
				appPath: own,
			})) as UpdaterFailure;
			expect(refused).toMatchObject({ ok: false, code: "not-an-app-bundle", path: own });
			expect(refused.message).toContain("cannot tell which bundle is its own");
			expect(await readFile(join(own, MARKER), "utf8")).toBe("old");
			await expect(stat(file.path)).resolves.toBeDefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("finding 1: a symlink is not the bundle, so install refuses it", async () => {
		const dir = await scratch();
		try {
			const own = await bundle(dir, "Notes.app", "old");
			const source = await bundle(dir, "Notes-new.app", "new");
			const alias = join(dir, "Alias.app");
			await symlink(own, alias);
			const { commands, file } = await verifiedDownload(source, executableOf(own));
			const refused = (await commands.install({
				path: file.path,
				appPath: alias,
			})) as UpdaterFailure;
			// A rename over a link would replace the link and leave the app in place, so it is
			// refused rather than reported as a successful install that changed nothing.
			expect(refused).toMatchObject({ ok: false, code: "not-an-app-bundle", path: alias });
			expect(refused.message).toContain("is a symlink");
			expect(await readFile(join(own, MARKER), "utf8")).toBe("old");
			await expect(stat(file.path)).resolves.toBeDefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("relaunch and install agree on which bundle is this app's", async () => {
		const dir = await scratch();
		try {
			const own = await bundle(dir, "Notes.app", "old");
			const foreign = await bundle(dir, "Other.app", "other");
			const source = await bundle(dir, "Notes-new.app", "new");
			const { commands, file } = await verifiedDownload(source, executableOf(own));
			const install = (await commands.install({
				path: file.path,
				appPath: foreign,
			})) as UpdaterFailure;
			const relaunch = (await commands.relaunch({ appPath: foreign })) as UpdaterFailure;
			const ownResolved = await realpath(own);
			expect(install.code).toBe(relaunch.code);
			expect(install.message).toContain(ownResolved);
			expect(relaunch.message).toContain(ownResolved);
			expect(install.message).toContain("install only replaces");
			expect(relaunch.message).toContain("relaunch only starts");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
