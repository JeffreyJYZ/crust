import { describe, expect, test } from "bun:test";
import { mkdir, realpath, rm, symlink } from "node:fs/promises";
import { join } from "node:path";

import type { BundleArgs, UpdaterFailure } from "@/plugins/updater";
import { ownBundleOf } from "@/plugins/updater-bundle";
import { bundle, offlineAdapter, plugin, scratch } from "@/plugins/updater-fake";

/** An adapter that records every bundle it is asked to start, so a test never opens one. */
function launching(): { adapter: ReturnType<typeof offlineAdapter>; started: string[] } {
	const started: string[] = [];
	const adapter = offlineAdapter({
		relaunch: async (appPath) => {
			started.push(appPath);
		},
	});
	return { adapter, started };
}

/** The executable inside a bundle: the shape `relaunch` derives this app's own bundle from. */
function executableOf(bundlePath: string): string {
	return join(bundlePath, "Contents", "MacOS", "Notes");
}

describe("ownBundleOf", () => {
	test("reads the bundle out of the executable path and nothing else", () => {
		expect(ownBundleOf("/Applications/Notes.app/Contents/MacOS/Notes")).toBe(
			"/Applications/Notes.app",
		);
		expect(ownBundleOf("/usr/local/bin/bun")).toBeUndefined();
		expect(ownBundleOf("/Applications/Notes.app/Contents/Resources/x")).toBeUndefined();
		expect(ownBundleOf("/Applications/Notes/Contents/MacOS/Notes")).toBeUndefined();
	});
});

describe("updater.relaunch, the own bundle only", () => {
	test("finding 15: a bundle the page names is refused, and this app's own bundle starts", async () => {
		const dir = await scratch();
		try {
			const own = await bundle(dir, "Notes.app", "own");
			const evil = await bundle(dir, "Evil.app", "evil");
			const { adapter, started } = launching();
			const execPath = executableOf(own);
			expect(await plugin(adapter, {}, execPath).relaunch({ appPath: own })).toEqual({
				ok: true,
				started: true,
			});
			const refused = (await plugin(adapter, {}, execPath).relaunch({
				appPath: evil,
			})) as UpdaterFailure;
			expect(refused).toMatchObject({ ok: false, code: "not-an-app-bundle", path: evil });
			// The refusal names the resolved own bundle, which on macOS is `/private/var/…`.
			expect(refused.message).toContain(
				`is not this app's bundle; relaunch only starts ${await realpath(own)}`,
			);
			expect(started).toEqual([own]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("finding 15: a symlink is judged by what it resolves to, not by its name", async () => {
		// A symlink that resolves to this app's own bundle IS that bundle, so it is accepted; one
		// that resolves anywhere else is refused. `realpath` on both sides is the comparison, which
		// is why a link cannot launder a foreign bundle into an accepted path.
		const dir = await scratch();
		try {
			const own = await bundle(dir, "Notes.app", "own");
			const evil = await bundle(dir, "Evil.app", "evil");
			const alias = join(dir, "Alias.app");
			const away = join(dir, "Away.app");
			await symlink(own, alias);
			await symlink(evil, away);
			const { adapter, started } = launching();
			const execPath = executableOf(own);
			expect(await plugin(adapter, {}, execPath).relaunch({ appPath: alias })).toEqual({
				ok: true,
				started: true,
			});
			expect(await plugin(adapter, {}, execPath).relaunch({ appPath: away })).toMatchObject({
				ok: false,
				code: "not-an-app-bundle",
			});
			expect(started).toEqual([alias]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("finding 15: a dev run refuses every relaunch rather than guessing", async () => {
		const dir = await scratch();
		try {
			const own = await bundle(dir, "Notes.app", "own");
			const { adapter, started } = launching();
			const dev = (await plugin(adapter, {}, "/usr/local/bin/bun").relaunch({
				appPath: own,
			})) as UpdaterFailure;
			expect(dev).toMatchObject({ ok: false, code: "not-an-app-bundle", path: own });
			expect(dev.message).toContain("cannot tell which bundle is its own");
			expect(started).toEqual([]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a missing appPath is invalid arguments before any bundle is resolved", async () => {
		const dir = await scratch();
		try {
			const own = await bundle(dir, "Notes.app", "own");
			const { adapter, started } = launching();
			expect(
				await plugin(adapter, {}, executableOf(own)).relaunch({} as BundleArgs),
			).toMatchObject({ ok: false, code: "invalid-arguments" });
			expect(started).toEqual([]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
