import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
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

async function scratch(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "crust-updater-"));
}

async function install(path: string, appPath: string): Promise<InstallResult | UpdaterFailure> {
	return await createUpdaterPlugin(offlineAdapter()).commands.install({ path, appPath });
}

async function bundle(dir: string, name: string, marker: string): Promise<string> {
	const path = join(dir, name);
	await mkdir(join(path, "Contents"), { recursive: true });
	await writeFile(join(path, "Contents", "marker.txt"), marker, "utf8");
	return path;
}

describe("updater.install", () => {
	test("renames the new bundle into place and keeps the old one aside", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "old");
			const source = await bundle(dir, "Notes-new.app", "new");
			expect(await install(source, appPath)).toMatchObject({
				ok: true,
				backup: `${appPath}.old`,
			});
			const marker = join("Contents", "marker.txt");
			expect(await readFile(join(appPath, marker), "utf8")).toBe("new");
			expect(await readFile(join(`${appPath}.old`, marker), "utf8")).toBe("old");
			await expect(stat(source)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("refuses a target or a download that is not an .app directory, replacing nothing", async () => {
		const dir = await scratch();
		try {
			const notAnApp = await bundle(dir, "Notes", "old");
			const source = await bundle(dir, "Notes-new.app", "new");
			const target = await bundle(dir, "Other.app", "old");
			const loose = join(dir, "loose");
			const file = join(dir, "Loose.app");
			await mkdir(loose);
			await writeFile(file, "not a bundle", "utf8");
			for (const [path, appPath] of [
				[source, notAnApp],
				[source, file],
				[loose, target],
			] as const) {
				expect(await install(path, appPath)).toMatchObject({
					ok: false,
					code: "not-an-app-bundle",
				});
			}
			expect(await readFile(join(notAnApp, "Contents", "marker.txt"), "utf8")).toBe("old");
			expect(await readFile(join(target, "Contents", "marker.txt"), "utf8")).toBe("old");
			await expect(stat(source)).resolves.toBeDefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
