/**
 * The page's own half of `crust:crash-reporter`: what an `onerror` in a render loop reports, where
 * those records land, and why an over-long stack is truncated instead of refused.
 * Nothing here faults a process; the record is written by the plugin into a temp root.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { crashLogPath, lastCrashPath } from "@/platform/darwin/crash-record";
import { createCrashReporterPlugin } from "@/plugins/crash-reporter";
import { isNotImplemented } from "@/plugins/define";
import { MAX_CRASH_CHARS, MAX_CRASH_RECORDS } from "@/runtime-crash-store";

const temps: string[] = [];

afterEach(async () => {
	while (temps.length > 0) await rm(temps.pop() as string, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "crust-crash-page-"));
	temps.push(dir);
	return dir;
}

const RUNNING = { running: () => true };

describe("a page report", () => {
	test("lands in the same store, marked webview", async () => {
		const root = await tempDir();
		const plugin = createCrashReporterPlugin({ root, guard: RUNNING });
		const reported = plugin.commands.report({ message: "onerror: bad token", stack: "at App" });
		expect(reported).toMatchObject({ ok: true, root, crash: { type: "webview" } });
		// The guard's readers answer it, which is the whole point of one store.
		expect(plugin.commands.last()).toMatchObject({
			root,
			crash: { type: "webview", message: "onerror: bad token", stack: "at App" },
		});
		expect(plugin.commands.list()).toMatchObject({ crashes: [{ type: "webview" }] });
		// Same 0600 as the guard's own artefact.
		expect((await stat(crashLogPath(root))).mode & 0o777).toBe(0o600);
		expect((await stat(lastCrashPath(root))).mode & 0o777).toBe(0o600);
	});

	test("is told apart from a guard record by `type`", async () => {
		const root = await tempDir();
		const plugin = createCrashReporterPlugin({ root, guard: RUNNING });
		plugin.commands.report({ message: "first" });
		const records = String(await readFile(crashLogPath(root), "utf8"))
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => JSON.parse(line) as { type: string });
		expect(records.map((record) => record.type)).toEqual(["webview"]);
	});

	test("an over-long message is truncated, never refused", async () => {
		const root = await tempDir();
		const plugin = createCrashReporterPlugin({ root, guard: RUNNING });
		const huge = "x".repeat(MAX_CRASH_CHARS + 500);
		const reported = plugin.commands.report({ message: huge, stack: huge });
		if (isNotImplemented(reported)) throw new Error("report was refused");
		expect(reported.ok).toBe(true);
		expect(reported.crash.message?.length).toBeLessThanOrEqual(MAX_CRASH_CHARS);
		expect(reported.crash.message).toContain(`[truncated ${huge.length} chars]`);
		// Written, not merely returned: the truncation is what reached the disk.
		const last = plugin.commands.last();
		if (isNotImplemented(last)) throw new Error("last was refused");
		expect(last.crash?.message).toBe(reported.crash.message);
	});

	test("the log drops its oldest records past the cap", async () => {
		const root = await tempDir();
		const plugin = createCrashReporterPlugin({ root, guard: RUNNING });
		for (let index = 0; index < MAX_CRASH_RECORDS + 5; index++) {
			plugin.commands.report({ message: `crash ${index}` });
		}
		const listed = plugin.commands.list();
		if (isNotImplemented(listed)) throw new Error("list was refused");
		expect(listed.crashes).toHaveLength(MAX_CRASH_RECORDS);
		expect(listed.crashes[listed.crashes.length - 1]?.message).toBe(
			`crash ${MAX_CRASH_RECORDS + 4}`,
		);
	});
});

describe("configure", () => {
	test("repoints the store inside the data root", async () => {
		const root = await tempDir();
		const elsewhere = join(root, "page-reports");
		await mkdir(elsewhere, { recursive: true });
		const plugin = createCrashReporterPlugin({ root, guard: RUNNING });
		expect(plugin.commands.configure({ dir: elsewhere })).toEqual({
			ok: true,
			dir: elsewhere,
			root: elsewhere,
		});
		plugin.commands.report({ message: "after the move" });
		expect(await readFile(join(elsewhere, "crashes.log"), "utf8")).toContain("after the move");
	});

	test("refuses a directory outside the data root", async () => {
		const root = await tempDir();
		const outside = await tempDir();
		const plugin = createCrashReporterPlugin({ root, guard: RUNNING });
		expect(plugin.commands.configure({ dir: outside })).toMatchObject({
			ok: false,
			code: "outside-data-root",
			root,
		});
		// A sibling whose name merely starts with the root's is still outside it.
		expect(plugin.commands.configure({ dir: `${root}-evil` })).toMatchObject({
			ok: false,
			code: "outside-data-root",
		});
		expect(plugin.commands.configure({ dir: "relative/dir" })).toMatchObject({ ok: false });
	});

	test("with no argument answers the directory in force, and moves nothing", async () => {
		const root = await tempDir();
		const plugin = createCrashReporterPlugin({ root, guard: RUNNING });
		expect(plugin.commands.configure({})).toEqual({ ok: true, dir: root, root });
	});

	test("takes no `url`: uploading is the app's decision, not this plugin's", () => {
		const plugin = createCrashReporterPlugin({ root: "/tmp/x", guard: RUNNING });
		const withUrl = { dir: undefined, url: "https://example.test/crash" };
		// Accepted as an unknown key and ignored, so no report is ever POSTed.
		expect(plugin.commands.configure(withUrl)).toEqual({
			ok: true,
			dir: "/tmp/x",
			root: "/tmp/x",
		});
	});
});
