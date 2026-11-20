/**
 * The human mirror's stream: severity decides where a line lands, so `2>` carries what a person is
 * watching for. A run whose `debug` and `info` lines all arrived on stderr looked entirely red, and
 * redirecting stderr to a file meant reading chatter as failures.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configureLogger, resetLogger, writeRecord } from "@/logging";
import type { LogLevel } from "@/logging/types";

interface Captured {
	out: string[];
	warn: string[];
	err: string[];
}

/** Every console channel swapped for an array, restored in a `finally` so a red case still ends clean. */
async function capture(run: () => Promise<void>): Promise<Captured> {
	const captured: Captured = { out: [], warn: [], err: [] };
	const originals = {
		log: console.log,
		warn: console.warn,
		error: console.error,
	};
	const push = (sink: string[]) => {
		return (...args: unknown[]): void => {
			sink.push(args.map((arg) => String(arg)).join(" "));
		};
	};
	console.log = push(captured.out);
	console.warn = push(captured.warn);
	console.error = push(captured.err);
	try {
		await run();
	} finally {
		console.log = originals.log;
		console.warn = originals.warn;
		console.error = originals.error;
	}
	return captured;
}

async function atLevel(level: LogLevel): Promise<Captured> {
	const root = await mkdtemp(join(tmpdir(), "crust-mirror-"));
	try {
		configureLogger({ root, level: "trace", dev: true });
		return await capture(async () => {
			await writeRecord({
				level,
				source: "app",
				event: "app.log",
				msg: `${level} line`,
			});
		});
	} finally {
		resetLogger();
		await rm(root, { recursive: true, force: true });
	}
}

describe("human mirror", () => {
	test("an info record reaches stdout and never stderr", async () => {
		const { out, err } = await atLevel("info");
		expect(out.join("\n")).toContain("INFO app app.log info line");
		expect(err).toEqual([]);
	});

	test("an error record reaches stderr and never stdout", async () => {
		const { out, err } = await atLevel("error");
		expect(err.join("\n")).toContain("ERROR app app.log error line");
		expect(out).toEqual([]);
	});

	test("a warn record goes through console.warn, not the error channel", async () => {
		const { out, warn, err } = await atLevel("warn");
		expect(warn.join("\n")).toContain("WARN app app.log warn line");
		expect(err).toEqual([]);
		expect(out).toEqual([]);
	});
});
