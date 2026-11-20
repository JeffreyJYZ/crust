/**
 * `app.command` refuses a handler that is not a function, at registration, naming the command and
 * what arrived. The usual `for (const name of COMMANDS) app.command(name, allHandlers[name])` table
 * otherwise registers `undefined` silently and the failure lands at call time as someone else's
 * TypeError.
 *
 * Registration also emits one `debug` line (`app.command.registered`) so a run's log records the
 * whole command surface it started with; at `info` a built app stays quiet.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "@/app.ts";
import type { Platform } from "@/app-types.ts";
import type { CrustConfig } from "@/config";
import { configureLogger, flushLogger, type LogRecord, parseLine, resetLogger } from "@/logging";

const CONFIG: CrustConfig = {
	app: { id: "land.jyz.commands", name: "commands", version: "1.0.0" },
	windows: [],
};

const PLATFORM = {} as unknown as Platform;

async function recordsOf(root: string): Promise<LogRecord[]> {
	const text = await readFile(join(root, "logs", "app.jsonl"), "utf8").catch(() => "");
	return text
		.split("\n")
		.filter(Boolean)
		.map((line) => parseLine(line))
		.filter((line): line is LogRecord => line !== undefined && !("raw" in line));
}

describe("app.command", () => {
	test("throws at registration for undefined and for a non-function value", () => {
		const app = createApp(PLATFORM, CONFIG);
		expect(() => app.command("missing", undefined as never)).toThrow(
			/crust: command "missing" needs a function handler, got undefined/,
		);
		expect(() => app.command("number", 42 as never)).toThrow(
			/crust: command "number" needs a function handler, got number/,
		);
	});

	test("a real handler registers, and the debug line appears only at debug", async () => {
		const root = await mkdtemp(join(tmpdir(), "crust-app-commands-"));
		try {
			configureLogger({ root, level: "debug" });
			createApp(PLATFORM, CONFIG).command("greet", () => "hi");
			await flushLogger();
			const records = await recordsOf(root);
			const registered = records.find((record) => record.event === "app.command.registered");
			expect(registered?.source).toBe("app");
			expect(registered?.level).toBe("debug");
			expect(registered?.name).toBe("greet");
		} finally {
			resetLogger();
			await rm(root, { recursive: true, force: true });
		}

		const quiet = await mkdtemp(join(tmpdir(), "crust-app-commands-"));
		try {
			configureLogger({ root: quiet, level: "info" });
			createApp(PLATFORM, CONFIG).command("greet", () => "hi");
			await flushLogger();
			expect(await recordsOf(quiet)).toEqual([]);
		} finally {
			resetLogger();
			await rm(quiet, { recursive: true, force: true });
		}
	});
});
