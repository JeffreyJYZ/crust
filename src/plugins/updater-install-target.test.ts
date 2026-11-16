/**
 * The destination half of finding 1: a receipt proves the bytes, and this proves the target. A page
 * that holds a genuinely verified artifact must still not be able to rename it over another app.
 */

import { describe, expect, test } from "bun:test";
import { readFile, realpath, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import type { UpdaterFailure } from "@/plugins/updater";
import { bundle, executableOf, plugin, scratch, verifiedDownload } from "@/plugins/updater-fake";

const MARKER = join("Contents", "marker.txt");

describe("updater.install, this app's bundle only", () => {
	test("finding 1: a verified artifact cannot be renamed over a foreign app", async () => {
		const dir = await scratch();
		try {
			const own = await bundle(dir, "Notes.app", "old");
			const foreign = await bundle(dir, "Other.app", "other");
			const source = await bundle(dir, "Notes-new.app", "new");
			const { commands, file } = await verifiedDownload(source, executableOf(own));
			const refused = (await commands.install({ path: file.path, appPath: foreign })) as
				| UpdaterFailure
				| { ok: true };
			expect(refused).toMatchObject({
				ok: false,
				code: "not-an-app-bundle",
				path: foreign,
			});
			const { message } = refused as UpdaterFailure;
			// Both paths are named: the one refused, and the only one install replaces.
			expect(message).toContain(foreign);
			expect(message).toContain(`install only replaces ${await realpath(own)}`);
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
			// The default `execPath` is the interpreter running this test, which is no bundle at all.
			const { commands, file } = await verifiedDownload(source, process.execPath);
			const refused = (await commands.install({ path: file.path, appPath: own })) as
				| UpdaterFailure
				| { ok: true };
			expect(refused).toMatchObject({ ok: false, code: "not-an-app-bundle", path: own });
			expect((refused as UpdaterFailure).message).toContain(
				"cannot tell which bundle is its own",
			);
			expect(await readFile(join(own, MARKER), "utf8")).toBe("old");
			await expect(stat(file.path)).resolves.toBeDefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("finding 1: a symlink to this app's own bundle is that bundle", async () => {
		const dir = await scratch();
		try {
			const own = await bundle(dir, "Notes.app", "old");
			const source = await bundle(dir, "Notes-new.app", "new");
			const alias = join(dir, "Alias.app");
			await Bun.write(join(dir, "placeholder"), "");
			await rm(join(dir, "placeholder"));
			await (await import("node:fs/promises")).symlink(own, alias);
			const { commands, file } = await verifiedDownload(source, executableOf(own));
			expect(await commands.install({ path: file.path, appPath: alias })).toMatchObject({
				ok: true,
				backup: `${alias}.old`,
			});
			expect(await readFile(join(own, MARKER), "utf8")).toBe("new");
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
			expect(install.code).toBe(relaunch.code);
			expect(install.message).toContain(await realpath(own));
			expect(relaunch.message).toContain(await realpath(own));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

/** The default plugin, for the dev-run proof: no adapter, so no network is reachable. */
export { plugin };
