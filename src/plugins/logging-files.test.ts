/**
 * `crust:logging` on disk, split from the level and tail proofs so each file stays one subject: the
 * names `logDirs` reports (which `crust:os` `paths` shares, so `appLog` cannot drift), rotation
 * across generations, and the warn-and-above error file with its single archive.
 *
 * `maxBytes: 1` makes rotation deterministic: the first write creates the live file, and every
 * write after it rotates first, so generation N holds the (N+1)th-newest record with no timing.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseLine, type LogRecord } from "@/logging";
import { createLoggingPlugin, logDirs, type WriteResult } from "@/plugins/logging";

const AT = Date.parse("2026-11-15T00:00:00.000Z");

async function scratch(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "crust-rotate-"));
}

function pluginAt(root: string, extra: Record<string, unknown> = {}) {
	return createLoggingPlugin({ root, now: () => AT, level: "debug", maxBytes: 1, ...extra });
}

function call<T>(plugin: ReturnType<typeof createLoggingPlugin>, name: string, args?: unknown): T {
	const table = plugin.commands as unknown as Record<string, (input?: unknown) => T>;
	const handler = table[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return handler(args);
}

async function exists(path: string): Promise<boolean> {
	return await stat(path).then(
		() => true,
		() => false,
	);
}

async function events(path: string): Promise<string[]> {
	const text = await readFile(path, "utf8").catch(() => "");
	return text
		.split("\n")
		.filter(Boolean)
		.map((line) => parseLine(line))
		.filter((line): line is LogRecord => line !== undefined && !("raw" in line))
		.map((record) => record.event);
}

describe("logging directories", () => {
	test("the sink writes logs/app.jsonl, and logDirs names it", async () => {
		const root = await scratch();
		try {
			const written = await call<WriteResult>(pluginAt(root), "write", {
				level: "info",
				message: "where",
			});
			expect(written.path).toBe(logDirs({ root }).file);
			expect(written.path).toBe(join(root, "logs", "app.jsonl"));
			expect(logDirs({ home: "/h", appId: "id" })).toEqual({
				home: "/h",
				root: "/h/Library/Application Support/id",
				logs: "/h/Library/Application Support/id/logs",
				file: "/h/Library/Application Support/id/logs/app.jsonl",
				errors: "/h/Library/Application Support/id/logs/errors.jsonl",
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("rotation across generations", () => {
	test("app.jsonl shifts into app.1.jsonl and upward, keeping three archives", async () => {
		const root = await scratch();
		try {
			const plugin = pluginAt(root, { generations: 3 });
			for (let index = 0; index < 6; index += 1) {
				await call(plugin, "write", { level: "info", message: `line ${index}` });
			}
			const logs = join(root, "logs");
			expect(await exists(join(logs, "app.jsonl"))).toBe(true);
			expect(await exists(join(logs, "app.1.jsonl"))).toBe(true);
			expect(await exists(join(logs, "app.2.jsonl"))).toBe(true);
			expect(await exists(join(logs, "app.3.jsonl"))).toBe(true);
			// Three generations is the cap: the fourth archive is deleted, oldest first.
			expect(await exists(join(logs, "app.4.jsonl"))).toBe(false);
			// The live file is the newest write, and each archive is one write older than the last.
			const live = await events(join(logs, "app.jsonl"));
			expect(live).toEqual(["log.write"]);
			expect(await readFile(join(logs, "app.1.jsonl"), "utf8")).toContain("line 4");
			expect(await readFile(join(logs, "app.2.jsonl"), "utf8")).toContain("line 3");
			expect(await readFile(join(logs, "app.3.jsonl"), "utf8")).toContain("line 2");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("errors.jsonl holds warn and above and keeps one archive", async () => {
		const root = await scratch();
		try {
			const plugin = pluginAt(root);
			await call(plugin, "write", { level: "info", message: "quiet" });
			await call(plugin, "write", { level: "warn", message: "first warning" });
			await call(plugin, "write", { level: "warn", message: "second warning" });
			const logs = join(root, "logs");
			const errors = await readFile(join(logs, "errors.jsonl"), "utf8");
			expect(errors).toContain("second warning");
			expect(errors).not.toContain("quiet");
			expect(await readFile(join(logs, "errors.1.jsonl"), "utf8")).toContain("first warning");
			expect(await exists(join(logs, "errors.2.jsonl"))).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
