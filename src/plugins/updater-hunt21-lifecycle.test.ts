/** hunt-21 updater answer shapes and temp lifetime: ok means the app came back, and nothing leaks. */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { DownloadResult, InstallFailure, UpdaterFailure } from "@/plugins/updater";
import {
	bundle,
	delivering,
	digestOf,
	executableOf,
	offlineAdapter,
	plugin,
	scratch,
	UPDATE_URL,
} from "@/plugins/updater-fake";
import { UpdaterAdapterError } from "@/plugins/updater-args";

const MARKER = join("Contents", "marker.txt");

describe("install reports the launch and the rollback honestly", () => {
	test("a failed relaunch is a typed failure that still names the landed swap", async () => {
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
			const file = (await commands.download({
				url: UPDATE_URL,
				sha256: await digestOf(source),
			})) as DownloadResult;
			const result = (await commands.install({
				path: file.path,
				appPath,
				relaunch: true,
			})) as UpdaterFailure;
			expect(result.ok).toBe(false);
			expect(result.code).toBe("relaunch-failed");
			expect(result).toMatchObject({
				installed: true,
				appPath,
				backup: `${appPath}.old`,
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a rollback that also failed is a distinct code naming the parked copy", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "old");
			const source = await bundle(dir, "Notes-new.app", "new");
			const commands = plugin(
				delivering(source, {
					replaceBundle: async () => {
						throw new UpdaterAdapterError(
							"rollback-failed",
							"forward rename failed and the restore failed too",
						);
					},
				}),
				{},
				executableOf(appPath),
			);
			const file = (await commands.download({
				url: UPDATE_URL,
				sha256: await digestOf(source),
			})) as DownloadResult;
			const result = (await commands.install({ path: file.path, appPath })) as InstallFailure;
			expect(result.code).toBe("rollback-failed");
			expect(result.parkedAt).toBe(`${appPath}.old`);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("updater temp directories do not outlive their use", () => {
	test("a refused download removes the directory it created", async () => {
		let made = "";
		const adapter = offlineAdapter({
			makeTempDir: async () => {
				made = await mkdtemp(join(tmpdir(), "crust-hunt21-"));
				return made;
			},
			download: async (_url, directory) => {
				const path = join(directory, "Notes.app.zip");
				await writeFile(path, "payload");
				return { path, bytes: 7 };
			},
		});
		const result = (await plugin(adapter).download({
			url: UPDATE_URL,
			sha256: "0".repeat(64),
		})) as UpdaterFailure;
		expect(result.code).toBe("hash-mismatch");
		expect(made).not.toBe("");
		await expect(stat(made)).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("a successful install removes the download and extraction directories", async () => {
		const dir = await scratch();
		try {
			const appPath = await bundle(dir, "Notes.app", "old");
			const source = await bundle(dir, "Notes-new.app", "new");
			const commands = plugin(delivering(source), {}, executableOf(appPath));
			const file = (await commands.download({
				url: UPDATE_URL,
				sha256: await digestOf(source),
			})) as DownloadResult;
			const downloadDir = dirname(file.path);
			expect(await stat(downloadDir)).toBeDefined();
			expect(await commands.install({ path: file.path, appPath })).toMatchObject({
				ok: true,
			});
			await expect(stat(downloadDir)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
