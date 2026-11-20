/**
 * `crust:logging`'s command surface against a temp root: the level filter, the JSONL append, `tail`
 * answering parsed objects with its filters, and the two hunt-50 findings that must not survive —
 * a sink-error line never appears in `tail`, and `WriteResult.line` is absent when nothing was
 * stored. Nothing here writes outside the temp directory.
 */

import { describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	configureLogger,
	flushLogger,
	type LogRecord,
	parseLine,
	resetLogger,
	tailRecords,
	writeRecord,
} from "@/logging";
import {
	createLoggingPlugin,
	type LogLevel,
	type TailResult,
	type WriteResult,
} from "@/plugins/logging";

const AT = Date.parse("2026-11-15T00:00:00.000Z");

async function scratch(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "crust-logging-"));
}

function call<T>(
	plugin: ReturnType<typeof createLoggingPlugin>,
	name: string,
	args?: unknown,
): Promise<T> {
	const table = plugin.commands as unknown as Record<string, (input?: unknown) => Promise<T>>;
	const handler = table[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return handler(args);
}

function pluginAt(root: string, level?: LogLevel): ReturnType<typeof createLoggingPlugin> {
	return createLoggingPlugin({ root, now: () => AT, level });
}

async function recordsOf(root: string): Promise<LogRecord[]> {
	const text = await readFile(join(root, "logs", "app.jsonl"), "utf8");
	return text
		.split("\n")
		.filter(Boolean)
		.map((line) => parseLine(line))
		.filter((line): line is LogRecord => line !== undefined && !("raw" in line));
}

describe("logging.write", () => {
	test("a line below the level is dropped before it reaches the file", async () => {
		const root = await scratch();
		try {
			const plugin = pluginAt(root);
			expect(
				await call<WriteResult>(plugin, "write", { level: "debug", message: "detail" }),
			).toEqual({
				written: false,
				reason: "below-level",
			});
			expect(
				await call<WriteResult>(plugin, "write", { level: "nope", message: "bad" }),
			).toEqual({
				written: false,
				reason: "bad-level",
			});
			expect(
				await readFile(join(root, "logs", "app.jsonl"), "utf8").catch(() => undefined),
			).toBe(undefined);
		} finally {
			resetLogger();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("stores one JSON object per line with the record's core fields", async () => {
		const root = await scratch();
		try {
			const written = await call<WriteResult>(pluginAt(root), "write", {
				level: "info",
				message: "hello disk",
			});
			expect(written.written).toBe(true);
			expect(written.path).toBe(join(root, "logs", "app.jsonl"));
			expect(JSON.parse(written.line as string)).toMatchObject({
				level: "info",
				source: "plugin",
				event: "log.write",
				msg: "hello disk",
				pid: process.pid,
			});
			const [record] = await recordsOf(root);
			expect(record?.ts).toBe("2026-11-15T00:00:00.000Z");
			expect(record?.seq).toBeGreaterThan(0);
		} finally {
			resetLogger();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("hunt-50 13/3: WriteResult.line is absent when nothing was stored", async () => {
		// `/dev/null/nope` cannot become a directory, so the append fails on the first write.
		const plugin = createLoggingPlugin({ root: "/dev/null/nope", now: () => AT });
		const failed = await call<WriteResult>(plugin, "write", {
			level: "info",
			message: "never",
		});
		expect(failed.written).toBe(false);
		expect(failed.reason).toBe("sink-error");
		expect(failed.line).toBeUndefined();
		expect(failed.path).toBeUndefined();
		resetLogger();
	});

	test("hunt-50 13/2: tail never shows a line the sink refused", async () => {
		const plugin = createLoggingPlugin({ root: "/dev/null/nope", now: () => AT });
		await call<WriteResult>(plugin, "write", { level: "info", message: "never-on-disk" });
		const tail = await call<TailResult>(plugin, "tail", {});
		expect(tail.records).toEqual([]);
		resetLogger();
	});
});

describe("logging.tail", () => {
	test("answers parsed records, newest last, filtered by level, source and since", async () => {
		const root = await scratch();
		try {
			configureLogger({ root, level: "debug", now: () => AT });
			await writeRecord({ level: "debug", source: "app", event: "app.log", msg: "quiet" });
			await writeRecord({
				level: "info",
				source: "bridge",
				event: "bridge.invoke",
				msg: "call",
			});
			await writeRecord({
				level: "warn",
				source: "page",
				event: "page.console",
				msg: "warned",
			});
			await flushLogger();

			const all = await tailRecords({});
			expect(all.records.map((record) => ("raw" in record ? "raw" : record.event))).toEqual([
				"app.log",
				"bridge.invoke",
				"page.console",
			]);
			const warnUp = await tailRecords({ level: "warn" });
			expect(warnUp.records.map((record) => ("raw" in record ? "raw" : record.msg))).toEqual([
				"warned",
			]);
			const bridges = await tailRecords({ source: "bridge" });
			expect(
				bridges.records.map((record) => ("raw" in record ? "raw" : record.event)),
			).toEqual(["bridge.invoke"]);
			const recent = await tailRecords({ since: AT + 1 });
			expect(recent.records).toEqual([]);
			const limited = await tailRecords({ limit: 1 });
			expect(
				limited.records.map((record) => ("raw" in record ? "raw" : record.event)),
			).toEqual(["page.console"]);
		} finally {
			resetLogger();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a corrupt line comes back as raw rather than breaking the read", async () => {
		const root = await scratch();
		try {
			const plugin = pluginAt(root);
			await call(plugin, "write", { level: "info", message: "good" });
			await appendFile(join(root, "logs", "app.jsonl"), "not json\n", "utf8");
			const tail = await call<TailResult>(plugin, "tail", { limit: 10 });
			expect(tail.records[0]).toMatchObject({ event: "log.write" });
			expect(tail.records[1]).toMatchObject({ raw: "not json" });
		} finally {
			resetLogger();
			await rm(root, { recursive: true, force: true });
		}
	});
});
