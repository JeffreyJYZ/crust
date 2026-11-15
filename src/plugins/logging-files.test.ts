/**
 * `crust:logging` on disk, split from the level and ring proofs so each file stays one subject: the
 * file `logDirs` names (which `crust:os` `paths` reports, so the two cannot drift), and rotation — past
 * 1 MiB the live file becomes `app.log.1` before the next line is appended, so the archive holds every
 * earlier line and nothing is lost across the move. The last test pins the generation count: an older
 * `.1` is replaced, never appended to, so the sink costs at most two files of disk.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createLoggingPlugin,
	logDirs,
	ROTATE_BYTES,
	ROTATED_NAME,
	type WriteResult,
} from "@/plugins/logging";

const AT = Date.parse("2026-11-15T00:00:00.000Z");

async function scratch(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "crust-rotate-"));
}

function pluginAt(root: string): ReturnType<typeof createLoggingPlugin> {
	return createLoggingPlugin({ root, now: () => AT, level: "debug" });
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

/** The file's lines, without the trailing newline reading as an empty one. */
async function lines(path: string): Promise<string[]> {
	return (await readFile(path, "utf8")).split("\n").filter(Boolean);
}

describe("logging directories", () => {
	test("the sink writes to the file logDirs names, so crust:os paths cannot drift", async () => {
		const root = await scratch();
		try {
			const written = await (call(pluginAt(root), "write", {
				level: "info",
				message: "where",
			}) as Promise<WriteResult>);
			expect(written.path).toBe(logDirs({ root }).file);
			expect(written.path).toBe(join(root, "logs", "app.log"));
			expect(logDirs({ home: "/h", appId: "id" })).toEqual({
				home: "/h",
				root: "/h/Library/Application Support/id",
				logs: "/h/Library/Application Support/id/logs",
				file: "/h/Library/Application Support/id/logs/app.log",
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("logging rotation", () => {
	test(`past ${ROTATE_BYTES} bytes app.log becomes ${ROTATED_NAME} with no line lost`, async () => {
		const root = await scratch();
		try {
			const plugin = pluginAt(root);
			const live = join(root, "logs", "app.log");
			const archive = join(root, "logs", ROTATED_NAME);
			const padding = "p".repeat(1000);
			const written: string[] = [];
			for (let index = 0; index < 2000; index += 1) {
				const result = await (call(plugin, "write", {
					level: "info",
					message: `${index} ${padding}`,
				}) as Promise<WriteResult>);
				expect(result.written).toBe(true);
				written.push(result.line ?? "");
				const size = (await stat(live).catch(() => ({ size: 0 }))).size;
				if (size > ROTATE_BYTES) break;
			}
			expect((await stat(live)).size).toBeGreaterThan(ROTATE_BYTES);

			// This write rotates first, so the whole pre-rotation file is the archive.
			const after = await (call(plugin, "write", {
				level: "info",
				message: "after rotation",
			}) as Promise<WriteResult>);
			expect(after.rotated).toBe(archive);
			written.push(after.line ?? "");

			const archived = await lines(archive);
			const current = await lines(live);
			expect(archived).toEqual(written.slice(0, -1));
			expect(current).toEqual(written.slice(-1));
			expect([...archived, ...current]).toEqual(written);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an older app.log.1 is replaced rather than appended to", async () => {
		const root = await scratch();
		try {
			const logs = join(root, "logs");
			await mkdir(logs, { recursive: true });
			const live = join(logs, "app.log");
			const archive = join(logs, ROTATED_NAME);
			const oversized = "x".repeat(ROTATE_BYTES + 1);
			await writeFile(archive, "stale generation\n", "utf8");
			await writeFile(live, oversized, "utf8");

			const result = await (call(pluginAt(root), "write", {
				level: "info",
				message: "fresh",
			}) as Promise<WriteResult>);
			expect(result.rotated).toBe(archive);
			expect(await readFile(archive, "utf8")).toBe(oversized);
			expect(await lines(live)).toEqual(["2026-11-15T00:00:00.000Z INFO fresh"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
