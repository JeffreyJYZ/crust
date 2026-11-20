/**
 * `crust:logging`'s one-call `configure`, the counterpart to Butter's `log:configure`: it repoints the
 * live file and moves the level together. The file is page-chosen, so the containment cases here are
 * the point — a relative path, a `..` walk, a sibling that merely starts the root, and a symlink
 * inside the root that resolves outside it are all refused and leave the sink where it was. Nothing
 * here writes outside a temp directory.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseLine, type LogRecord } from "@/logging";
import { createLoggingPlugin, type LogLevel, type WriteResult } from "@/plugins/logging";
import { type ConfigureResult, resolveLogFile } from "@/plugins/logging-configure";

const AT = Date.parse("2026-11-15T00:00:00.000Z");

async function scratch(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "crust-log-config-"));
}

function pluginAt(root: string) {
	// `maxBytes: 1` makes the next write rotate, so the archive's location is proved without 5 MiB.
	return createLoggingPlugin({ root, now: () => AT, maxBytes: 1 });
}

function call<T>(plugin: ReturnType<typeof createLoggingPlugin>, name: string, args?: unknown): T {
	const table = plugin.commands as unknown as Record<string, (input?: unknown) => T>;
	const handler = table[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return handler(args);
}

async function written(plugin: ReturnType<typeof createLoggingPlugin>, message: string) {
	return await (call(plugin, "write", { level: "info", message }) as Promise<WriteResult>);
}

async function recordAt(path: string): Promise<LogRecord | undefined> {
	const line = (await readFile(path, "utf8")).split("\n").filter(Boolean)[0];
	if (line === undefined) return undefined;
	const parsed = parseLine(line);
	return parsed !== undefined && !("raw" in parsed) ? parsed : undefined;
}

describe("logging.configure level", () => {
	test("moves the level in one call and refuses an unknown one without changing it", async () => {
		const root = await scratch();
		try {
			const plugin = pluginAt(root);
			expect(call<ConfigureResult>(plugin, "configure", { level: "debug" })).toEqual({
				ok: true,
				file: join(root, "logs", "app.jsonl"),
				level: "debug",
			});
			expect(call<LogLevel>(plugin, "level")).toBe("debug");
			expect((await written(plugin, "kept")).written).toBe(true);

			const refused = call<ConfigureResult>(plugin, "configure", { level: "verbose" });
			expect(refused.ok).toBe(false);
			expect(refused.error).toContain("not a level");
			expect(call<LogLevel>(plugin, "level")).toBe("debug");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("logging.configure file", () => {
	test("repoints the sink and the archive lives beside the new file", async () => {
		const root = await scratch();
		try {
			const plugin = pluginAt(root);
			const oldFile = join(root, "logs", "app.jsonl");
			const newFile = join(root, "elsewhere", "runtime.jsonl");
			expect(call<ConfigureResult>(plugin, "configure", { file: newFile }).file).toBe(
				newFile,
			);
			expect((await written(plugin, "after repoint")).path).toBe(newFile);
			expect((await recordAt(newFile))?.msg).toBe("after repoint");
			expect(await readFile(oldFile, "utf8").catch(() => undefined)).toBe(undefined);

			// Rotation uses the sibling of the live file, not the original logs directory.
			const rotated = await written(plugin, "rotated");
			expect(rotated.rotated).toBe(join(root, "elsewhere", "runtime.1.jsonl"));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("file and level in one call take effect together", async () => {
		const root = await scratch();
		try {
			const plugin = pluginAt(root);
			const newFile = join(root, "trace.jsonl");
			const result = call<ConfigureResult>(plugin, "configure", {
				file: newFile,
				level: "trace",
			});
			expect(result).toEqual({ ok: true, file: newFile, level: "trace" });
			const write = await (call(plugin, "write", {
				level: "trace",
				message: "both",
			}) as Promise<WriteResult>);
			expect(write.path).toBe(newFile);
			expect((await recordAt(newFile))?.level).toBe("trace");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("logging.configure containment", () => {
	test("relative, .., sibling and symlink escapes are refused and leave the sink put", async () => {
		const root = await scratch();
		try {
			const plugin = pluginAt(root);
			const outside = join(`${root}-other`, "leak.jsonl");
			const link = join(root, "link.jsonl");
			await symlink(outside, link);
			for (const bad of ["relative.jsonl", join(root, "..", "escape.jsonl"), outside, link]) {
				const result = call<ConfigureResult>(plugin, "configure", { file: bad });
				expect(result.ok, bad).toBe(false);
				expect(result.error, bad).toContain("logging.configure");
			}
			expect((await written(plugin, "stayed")).path).toBe(join(root, "logs", "app.jsonl"));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("the resolver accepts a path the plugin writes exactly as resolved", async () => {
		const root = await scratch();
		try {
			const nested = join(root, "deep", "dir");
			await mkdir(nested, { recursive: true });
			const target = join(nested, "nested.jsonl");
			expect(resolveLogFile(root, target)).toBe(target);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
