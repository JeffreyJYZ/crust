/**
 * The crash-reporter configure fence, proven with real symlinks in temp roots: a link inside the
 * data root must not write records outside it. Nothing here installs a handler or faults a process.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCrashReporterPlugin } from "@/plugins/crash-reporter";

const temps: string[] = [];

afterEach(async () => {
	while (temps.length > 0) await rm(temps.pop() as string, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "crust-crash-reporter-fence-"));
	temps.push(dir);
	return dir;
}

const RUNNING = { running: () => true };

describe("crash-reporter configure fence", () => {
	test("a symlink inside the data root pointing outside is refused", async () => {
		const root = await tempDir();
		const outside = await tempDir();
		const link = join(root, "escape");
		await symlink(outside, link, "dir");
		const plugin = createCrashReporterPlugin({ root, guard: RUNNING });
		expect(plugin.commands.configure({ dir: link })).toMatchObject({
			ok: false,
			code: "outside-data-root",
		});
		// The refusal moved nothing: a later report still lands in the real root, not outside.
		plugin.commands.report({ message: "stays inside" });
		expect(await readdir(outside)).toEqual([]);
	});

	test("a dangling symlink inside the root pointing outside is refused", async () => {
		const root = await tempDir();
		const outside = await tempDir();
		const link = join(root, "dangling");
		await symlink(join(outside, "not-created-yet"), link, "dir");
		const plugin = createCrashReporterPlugin({ root, guard: RUNNING });
		expect(plugin.commands.configure({ dir: link })).toMatchObject({
			ok: false,
			code: "outside-data-root",
		});
	});

	test("a symlink pointing to a directory inside the root is allowed", async () => {
		const root = await tempDir();
		const inner = join(root, "reports");
		await mkdir(inner, { recursive: true });
		const link = join(root, "alias");
		await symlink(inner, link, "dir");
		const plugin = createCrashReporterPlugin({ root, guard: RUNNING });
		expect(plugin.commands.configure({ dir: link })).toMatchObject({ ok: true });
	});
});
