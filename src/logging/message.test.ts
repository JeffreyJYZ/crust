/**
 * Message bounds at the two untrusted producers: a page console/ error line and `logging.write`.
 * A silent cut or an embedded newline would either hide the tail or forge a mirror line.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	configureLogger,
	MAX_MSG_CHARS,
	pageRecord,
	resetLogger,
	writeRecord,
	type WriteResult,
} from "@/logging";
import { createLoggingPlugin } from "@/plugins/logging";

async function scratch(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "crust-message-"));
}

async function storedMsg(root: string): Promise<string> {
	const text = await readFile(join(root, "logs", "app.jsonl"), "utf8");
	const lines = text.trim().split("\n");
	expect(lines).toHaveLength(1);
	return (JSON.parse(lines[0] ?? "{}") as { msg: string }).msg ?? "";
}

describe("message bounds", () => {
	test("a page console line is folded, capped and visibly truncated", async () => {
		const root = await scratch();
		try {
			configureLogger({ root, level: "trace" });
			const msg = await writeRecord(
				pageRecord({ kind: "console", args: [`x\n${"y".repeat(5000)}`] }),
			);
			expect(msg.written).toBe(true);
			const stored = await storedMsg(root);
			expect(stored).not.toContain("\n");
			expect(stored.length).toBe(MAX_MSG_CHARS);
			expect(stored.endsWith("…")).toBe(true);
		} finally {
			resetLogger();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a page error is capped at MAX_MSG_CHARS, not the route's 4000", async () => {
		const root = await scratch();
		try {
			configureLogger({ root, level: "trace" });
			const result = await writeRecord(
				pageRecord({ kind: "error", message: "E".repeat(4000) }),
			);
			expect(result.written).toBe(true);
			const stored = await storedMsg(root);
			expect(stored.length).toBe(MAX_MSG_CHARS);
			expect(stored.endsWith("…")).toBe(true);
		} finally {
			resetLogger();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("logging.write folds a newline and caps the message before storing it", async () => {
		const root = await scratch();
		try {
			const plugin = createLoggingPlugin({ root });
			const table = plugin.commands as unknown as Record<
				string,
				(input: unknown) => Promise<WriteResult>
			>;
			const result = await table.write?.({
				level: "info",
				message: `ok\nERROR platform forged ${"z".repeat(5000)}`,
			});
			expect(result?.written).toBe(true);
			const stored = await storedMsg(root);
			expect(stored).not.toContain("\n");
			expect(stored.length).toBe(MAX_MSG_CHARS);
			expect(stored.endsWith("…")).toBe(true);
		} finally {
			resetLogger();
			await rm(root, { recursive: true, force: true });
		}
	});
});
