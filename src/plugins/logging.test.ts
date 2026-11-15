/**
 * `crust:logging` against a temp root: the level filter dropping what is below it, the append-only sink, the
 * 200-line ring `tail` reads, and a pinned clock so the timestamp is a fact rather than a range. Nothing here
 * writes outside the temp directory.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createLoggingPlugin,
	type LogLevel,
	RING_SIZE,
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
): T {
	const table = plugin.commands as unknown as Record<string, (input?: unknown) => T>;
	const handler = table[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return handler(args);
}

function pluginAt(root: string, level?: LogLevel): ReturnType<typeof createLoggingPlugin> {
	return createLoggingPlugin({ root, now: () => AT, level });
}

describe("logging level", () => {
	test("defaults to info and reports a change only for a real level", async () => {
		const root = await scratch();
		try {
			const plugin = pluginAt(root);
			expect(call<LogLevel>(plugin, "level")).toBe("info");
			expect(call(plugin, "setLevel", { level: "debug" })).toEqual({
				level: "debug",
				changed: true,
			});
			expect(call(plugin, "setLevel", { level: "debug" })).toEqual({
				level: "debug",
				changed: false,
			});
			expect(call(plugin, "setLevel", { level: "verbose" })).toEqual({
				level: "debug",
				changed: false,
			});
			expect(call<LogLevel>(plugin, "level")).toBe("debug");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a line below the configured level is dropped before it reaches the file", async () => {
		const root = await scratch();
		try {
			const plugin = pluginAt(root);
			const result = await (call(plugin, "write", {
				level: "debug",
				message: "quiet detail",
			}) as Promise<WriteResult>);
			expect(result).toEqual({ written: false, reason: "below-level" });
			// Nothing was formatted, so nothing was appended either.
			expect(await readFile(join(root, "logs", "app.log"), "utf8").catch(() => undefined)).toBe(
				undefined,
			);

			call(plugin, "setLevel", { level: "debug" });
			const kept = await (call(plugin, "write", {
				level: "debug",
				message: "quiet detail",
			}) as Promise<WriteResult>);
			expect(kept.written).toBe(true);
			expect(kept.path).toBe(join(root, "logs", "app.log"));
			expect(kept.line).toBe("2026-11-15T00:00:00.000Z DEBUG quiet detail");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an unknown level is refused, not written as-is", async () => {
		const root = await scratch();
		try {
			const plugin = pluginAt(root);
			const result = await (call(plugin, "write", {
				level: "trace",
				message: "nope",
			}) as Promise<WriteResult>);
			expect(result).toEqual({ written: false, reason: "bad-level" });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("logging sink", () => {
	test("appends one timestamped line per write under logs/app.log", async () => {
		const root = await scratch();
		try {
			const plugin = pluginAt(root);
			await (call(plugin, "write", { level: "info", message: "first" }) as Promise<WriteResult>);
			await (call(plugin, "write", { level: "error", message: "second" }) as Promise<WriteResult>);
			const text = await readFile(join(root, "logs", "app.log"), "utf8");
			expect(text.split("\n").filter(Boolean)).toEqual([
				"2026-11-15T00:00:00.000Z INFO first",
				"2026-11-15T00:00:00.000Z ERROR second",
			]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("logging tail", () => {
	test("returns the last `limit` lines from the ring", async () => {
		const root = await scratch();
		try {
			const plugin = pluginAt(root, "debug");
			for (let index = 0; index < 5; index += 1) {
				await (call(plugin, "write", {
					level: "info",
					message: `line ${index}`,
				}) as Promise<WriteResult>);
			}
			const tail = call<TailResult>(plugin, "tail", { limit: 2 });
			expect(tail.lines).toEqual([
				"2026-11-15T00:00:00.000Z INFO line 3",
				"2026-11-15T00:00:00.000Z INFO line 4",
			]);
			expect(call<TailResult>(plugin, "tail", { limit: 0 }).lines).toEqual([]);
			expect(call<TailResult>(plugin, "tail").lines).toHaveLength(5);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test(`keeps at most ${RING_SIZE} lines, dropping the oldest`, async () => {
		const root = await scratch();
		try {
			const plugin = pluginAt(root, "debug");
			for (let index = 0; index < RING_SIZE + 5; index += 1) {
				await (call(plugin, "write", {
					level: "debug",
					message: `line ${index}`,
				}) as Promise<WriteResult>);
			}
			const { lines } = call<TailResult>(plugin, "tail", { limit: RING_SIZE + 50 });
			expect(lines).toHaveLength(RING_SIZE);
			expect(lines[0]).toBe(`2026-11-15T00:00:00.000Z DEBUG line 5`);
			expect(lines.at(-1)).toBe(`2026-11-15T00:00:00.000Z DEBUG line ${RING_SIZE + 4}`);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
