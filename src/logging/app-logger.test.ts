/**
 * The SDK logger an app's own `main.ts` and handlers use: `source: "app"`, `event: "app.log"`, the
 * same level filter, the same JSONL and the same redaction as the framework's events. It needs no
 * platform and no window, which is why it is provable here with only a temp root.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	configureLogger,
	flushLogger,
	type LogRecord,
	log,
	parseLine,
	REDACTED,
	resetLogger,
} from "@/logging";

async function scratch(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "crust-app-log-"));
}

async function recordsOf(root: string): Promise<LogRecord[]> {
	const text = await readFile(join(root, "logs", "app.jsonl"), "utf8").catch(() => "");
	return text
		.split("\n")
		.filter(Boolean)
		.map((line) => parseLine(line))
		.filter((line): line is LogRecord => line !== undefined && !("raw" in line));
}

describe("app logger", () => {
	test("an app line lands with source app, its fields intact and a secret redacted", async () => {
		const root = await scratch();
		try {
			configureLogger({ root, level: "debug" });
			log.info("sync finished", { files: 12, ms: 340, token: "sk-live-secret" });
			await flushLogger();
			const [record] = await recordsOf(root);
			expect(record).toMatchObject({
				level: "info",
				source: "app",
				event: "app.log",
				msg: "sync finished",
			});
			expect(record?.files).toBe(12);
			expect(record?.ms).toBe(340);
			expect(record?.token).toBe(REDACTED);
			expect(JSON.stringify(record)).not.toContain("sk-live-secret");
		} finally {
			resetLogger();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a tag names the subsystem, and a token in the message is redacted", async () => {
		const root = await scratch();
		try {
			configureLogger({ root, level: "debug" });
			log.tag("net").warn("retrying GET /x?token=abc123", { attempt: 2 });
			await flushLogger();
			const [record] = await recordsOf(root);
			expect(record?.level).toBe("warn");
			expect(record?.tag).toBe("net");
			expect(record?.attempt).toBe(2);
			expect(record?.msg).toBe(`retrying GET /x?token=${REDACTED}`);
		} finally {
			resetLogger();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("the level filter silences an app's info line at warn", async () => {
		const root = await scratch();
		try {
			configureLogger({ root, level: "warn" });
			log.info("too quiet");
			log.debug("quieter");
			log.warn("kept");
			await flushLogger();
			const records = await recordsOf(root);
			expect(records.map((record) => record.msg)).toEqual(["kept"]);
		} finally {
			resetLogger();
			await rm(root, { recursive: true, force: true });
		}
	});
});
