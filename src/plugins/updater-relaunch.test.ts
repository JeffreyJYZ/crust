import { describe, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import type {
	DownloadResult,
	InstallResult,
	UpdaterAdapter,
	UpdaterFailure,
} from "@/plugins/updater";
import {
	bundle,
	delivering,
	digestOf,
	offlineAdapter,
	plugin,
	scratch,
	UPDATE_URL,
} from "@/plugins/updater-fake";

const MARKER = join("Contents", "marker.txt");

/** The executable inside a bundle: the shape `relaunch` derives this app's own bundle from. */
function executableOf(bundlePath: string): string {
	return join(bundlePath, "Contents", "MacOS", "Notes");
}

/** An adapter that records every bundle it is asked to start, so a test never opens one. */
function launching(): { adapter: UpdaterAdapter; started: string[] } {
	const started: string[] = [];
	const adapter = offlineAdapter({
		relaunch: async (appPath) => {
			started.push(appPath);
		},
	});
	return { adapter, started };
}

describe("updater.relaunch", () => {
	test("starts this app's own bundle through the adapter and answers started", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "new");
			const { adapter, started } = launching();
			const commands = plugin(adapter, {}, executableOf(appPath));
			expect(await commands.relaunch({ appPath })).toEqual({ ok: true, started: true });
			expect(started).toEqual([appPath]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("refuses anything that is not an existing .app directory, starting nothing", async () => {
		const dir = await scratch();
		try {
			const own = await bundle(dir, "Notes.app", "new");
			const loose = join(dir, "Loose");
			const file = join(dir, "Loose.app");
			await Bun.write(file, "not a bundle");
			const { adapter, started } = launching();
			const commands = plugin(adapter, {}, executableOf(own));
			for (const appPath of [loose, file, join(dir, "Gone.app")]) {
				expect(await commands.relaunch({ appPath })).toMatchObject({
					ok: false,
					code: "not-an-app-bundle",
					path: appPath,
				});
			}
			expect(started).toEqual([]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("no launcher, or a launcher that throws, answers relaunch-failed", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "new");
			const bare = offlineAdapter({ relaunch: undefined });
			expect(
				await plugin(bare, {}, executableOf(appPath)).relaunch({ appPath }),
			).toMatchObject({ ok: false, code: "relaunch-failed" });
			const broken = offlineAdapter({
				relaunch: async () => {
					throw new Error("open: no such file");
				},
			});
			const result = (await plugin(broken, {}, executableOf(appPath)).relaunch({
				appPath,
			})) as UpdaterFailure;
			expect(result).toMatchObject({
				ok: false,
				code: "relaunch-failed",
				message: "open: no such file",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("updater.install with relaunch", () => {
	/** Download the artifact, so `install` has the receipt it refuses to work without. */
	async function verified(commands: ReturnType<typeof plugin>, source: string): Promise<string> {
		const sha256 = await digestOf(source);
		const file = (await commands.download({ url: UPDATE_URL, sha256 })) as DownloadResult;
		return file.path;
	}

	test("starts the replaced bundle once the swap has landed", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "old");
			const source = await bundle(dir, "Notes-new.app", "new");
			const started: string[] = [];
			const adapter = delivering(source, {
				relaunch: async (launched) => {
					started.push(launched);
				},
			});
			const commands = plugin(adapter, {}, executableOf(appPath));
			const path = await verified(commands, source);
			expect(await commands.install({ path, appPath, relaunch: true })).toEqual({
				ok: true,
				appPath,
				backup: `${appPath}.old`,
			});
			expect(started).toEqual([appPath]);
			expect(await readFile(join(appPath, MARKER), "utf8")).toBe("new");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a launch that fails is reported beside the install, never rolled back", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "old");
			const source = await bundle(dir, "Notes-new.app", "new");
			const commands = plugin(
				delivering(source, {
					relaunch: async () => {
						throw new Error("open: killed");
					},
				}),
				{},
				executableOf(appPath),
			);
			const path = await verified(commands, source);
			const result = (await commands.install({
				path,
				appPath,
				relaunch: true,
			})) as InstallResult;
			expect(result).toMatchObject({
				ok: true,
				backup: `${appPath}.old`,
				relaunchError: { code: "relaunch-failed", message: "open: killed" },
			});
			expect(await readFile(join(appPath, MARKER), "utf8")).toBe("new");
			expect(await readFile(join(`${appPath}.old`, MARKER), "utf8")).toBe("old");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("install without the option starts nothing", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "old");
			const source = await bundle(dir, "Notes-new.app", "new");
			const { adapter, started } = launching();
			const commands = plugin(
				delivering(source, { relaunch: adapter.relaunch }),
				{},
				executableOf(appPath),
			);
			const path = await verified(commands, source);
			expect(await commands.install({ path, appPath })).toMatchObject({
				ok: true,
				backup: `${appPath}.old`,
			});
			expect(started).toEqual([]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
