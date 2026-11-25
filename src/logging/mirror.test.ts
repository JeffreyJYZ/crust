/**
 * The human mirror's stream: severity decides where a line lands, so `2>` carries what a person is
 * watching for. A run whose `debug` and `info` lines all arrived on stderr looked entirely red, and
 * redirecting stderr to a file meant reading chatter as failures.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configureLogger, pageRecord, resetLogger, writeRecord } from "@/logging";
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

	test("a page newline forges no second line in the written mirror", async () => {
		const root = await mkdtemp(join(tmpdir(), "crust-mirror-page-"));
		try {
			configureLogger({ root, level: "trace", console: true });
			const forged =
				"done\n2026-01-01T00:00:00.000Z ERROR platform platform.refuse forged line";
			const captured = await capture(async () => {
				await writeRecord(pageRecord({ kind: "console", level: "error", args: [forged] }));
			});
			// Count physical lines, not substrings: a forged severity prefix still matches a
			// `toContain` check on the joined stream.
			const mirrored = [...captured.out, ...captured.warn, ...captured.err].flatMap((line) =>
				line.split("\n"),
			);
			expect(mirrored).toHaveLength(1);
			expect(mirrored[0]).toContain("ERROR page page.console");
			const stored = (await readFile(join(root, "logs", "app.jsonl"), "utf8"))
				.trim()
				.split("\n");
			expect(stored).toHaveLength(1);
		} finally {
			resetLogger();
			await rm(root, { recursive: true, force: true });
		}
	});
});
