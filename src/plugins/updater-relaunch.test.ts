import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	type BundleArgs,
	createUpdaterPlugin,
	type InstallResult,
	nodeUpdaterAdapter,
	type UpdaterAdapter,
	type UpdaterFailure,
} from "@/plugins/updater";

function offlineAdapter(overrides: Partial<UpdaterAdapter> = {}): UpdaterAdapter {
	const no = () => Promise.reject(new Error("a test tried to reach the network"));
	const fake = { ...nodeUpdaterAdapter(), fetchJson: no, download: no, relaunch: no };
	return { ...fake, ...overrides };
}

function plugin(adapter: UpdaterAdapter) {
	return createUpdaterPlugin(adapter).commands;
}

async function scratch(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "crust-updater-"));
}

async function bundle(dir: string, name: string, marker: string): Promise<string> {
	const path = join(dir, name);
	await mkdir(join(path, "Contents"), { recursive: true });
	await writeFile(join(path, "Contents", "marker.txt"), marker, "utf8");
	return path;
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
	test("starts the bundle through the adapter and answers started", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "new");
			const { adapter, started } = launching();
			expect(await plugin(adapter).relaunch({ appPath })).toEqual({
				ok: true,
				started: true,
			});
			expect(started).toEqual([appPath]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("refuses anything that is not an existing .app directory, starting nothing", async () => {
		const dir = await scratch();
		try {
			const loose = join(dir, "Notes");
			const file = join(dir, "Loose.app");
			await mkdir(loose);
			await writeFile(file, "not a bundle", "utf8");
			const { adapter, started } = launching();
			for (const appPath of [loose, file, join(dir, "Gone.app")]) {
				expect(await plugin(adapter).relaunch({ appPath })).toMatchObject({
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
			expect(await plugin(bare).relaunch({ appPath })).toMatchObject({
				ok: false,
				code: "relaunch-failed",
			});
			const broken = offlineAdapter({
				relaunch: async () => {
					throw new Error("open: no such file");
				},
			});
			expect(await plugin(broken).relaunch({ appPath })).toMatchObject({
				ok: false,
				code: "relaunch-failed",
				message: "open: no such file",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a missing appPath is invalid arguments, never a throw", async () => {
		const { adapter } = launching();
		const result = (await plugin(adapter).relaunch({} as BundleArgs)) as UpdaterFailure;
		expect(result).toMatchObject({ ok: false, code: "invalid-arguments" });
	});
});

describe("updater.install with relaunch", () => {
	test("starts the replaced bundle once the swap has landed", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "old");
			const source = await bundle(dir, "Notes-new.app", "new");
			const { adapter, started } = launching();
			const args = { path: source, appPath, relaunch: true };
			expect(await plugin(adapter).install(args)).toEqual({
				ok: true,
				appPath,
				backup: `${appPath}.old`,
			});
			expect(started).toEqual([appPath]);
			expect(await readFile(join(appPath, "Contents", "marker.txt"), "utf8")).toBe("new");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a launch that fails is reported beside the install, never rolled back", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "old");
			const source = await bundle(dir, "Notes-new.app", "new");
			const adapter = offlineAdapter({
				relaunch: async () => {
					throw new Error("open: killed");
				},
			});
			const args = { path: source, appPath, relaunch: true };
			const result = (await plugin(adapter).install(args)) as InstallResult;
			expect(result).toMatchObject({
				ok: true,
				backup: `${appPath}.old`,
				relaunchError: { code: "relaunch-failed", message: "open: killed" },
			});
			const marker = join("Contents", "marker.txt");
			expect(await readFile(join(appPath, marker), "utf8")).toBe("new");
			expect(await readFile(join(`${appPath}.old`, marker), "utf8")).toBe("old");
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
			expect(await plugin(adapter).install({ path: source, appPath })).toMatchObject({
				ok: true,
				backup: `${appPath}.old`,
			});
			expect(started).toEqual([]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
