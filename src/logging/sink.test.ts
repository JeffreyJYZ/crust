/**
 * The file sink's two data-loss paths: a partial line handed back by `tail` must not carry a
 * credential, and the triage file must not be a second copy of page warnings a page can emit freely.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSink } from "@/logging/sink";
import { buildRecord } from "@/logging/record";
import { REDACTED } from "@/logging/redact";
import type { LogRecord } from "@/logging/types";

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "crust-sink-"));
	return {
		root,
		file: join(root, "app.jsonl"),
		errors: join(root, "errors.jsonl"),
		async close() {
			await rm(root, { recursive: true, force: true });
		},
	};
}

function record(source: LogRecord["source"], level: LogRecord["level"]): LogRecord {
	return {
		ts: new Date().toISOString(),
		level,
		source,
		event: "test.line",
		msg: "hello",
		pid: 1,
		seq: 1,
	};
}

describe("the log sink", () => {
	test("a truncated line's raw fragment is redacted before tail returns it", async () => {
		const at = await fixture();
		try {
			await writeFile(at.file, `{"ts":"x","level":"warn","seq":2,"token":"sk-live-RAWLEAK"`);
			const answer = await createSink({ file: at.file, errorsFile: at.errors }).tail();
			const raw = answer.records[0];
			expect(raw).toBeDefined();
			expect("raw" in raw!).toBe(true);
			expect(JSON.stringify(raw)).not.toContain("sk-live-RAWLEAK");
			expect(JSON.stringify(raw)).toContain(REDACTED);
		} finally {
			await at.close();
		}
	});

	test("every cookie pair is redacted in the line that reaches disk", async () => {
		const at = await fixture();
		try {
			const sink = createSink({ file: at.file, errorsFile: at.errors });
			const header = "Cookie: session=sk-live-XYZ; token=abc123; jwt=eyJx";
			await sink.write(
				buildRecord(
					{ level: "info", source: "page", event: "fetch.failed", msg: header },
					0,
					1,
					1,
				),
			);
			await sink.flush();
			const written = JSON.parse((await readFile(at.file, "utf8")).trim());
			expect(written.msg).toBe(
				`Cookie: session=${REDACTED}; token=${REDACTED}; jwt=${REDACTED}`,
			);
			for (const secret of ["sk-live-XYZ", "abc123", "eyJx"])
				expect(written.msg).not.toContain(secret);
		} finally {
			await at.close();
		}
	});

	test("page warnings do not fill the errors file; framework warnings still do", async () => {
		const at = await fixture();
		try {
			const sink = createSink({ file: at.file, errorsFile: at.errors });
			await sink.write(record("page", "warn"));
			await sink.write(record("bridge", "warn"));
			await sink.flush();
			const app = await readFile(at.file, "utf8");
			const errors = await readFile(at.errors, "utf8");
			expect(app).toContain("test.line");
			expect(errors).toContain("test.line");
			expect(errors.split("\n").filter(Boolean)).toHaveLength(1);
			expect(JSON.parse(errors.trim()).source).toBe("bridge");
		} finally {
			await at.close();
		}
	});
});
