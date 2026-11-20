/**
 * The wiring end to end: a real bridge, a real capability gate, a real request. This is the proof
 * the brief asks for — a failing invoke appears with `code: "forbidden"` and `durMs` a number, a
 * successful one is alongside it, a refused capability names itself, a page error arrives through
 * the page-log route, and no line contains the bridge token.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startBridge, type BridgeHandle } from "@/bridge/server.ts";
import { DEFAULT_WINDOW_LABEL } from "@/bridge/window-identity.ts";
import { configureLogger, flushLogger, type LogRecord, parseLine, resetLogger } from "@/logging";
import { definePlugin } from "@/plugins/define";

const plugin = definePlugin({
	name: "test",
	commands: {
		echo: (args: unknown) => args,
		refuse: () => ({ ok: true }),
	},
});

let bridge: BridgeHandle | undefined;
let root: string | undefined;

afterEach(async () => {
	await bridge?.stop();
	bridge = undefined;
	resetLogger();
	if (root !== undefined) await rm(root, { recursive: true, force: true });
	root = undefined;
});

async function startAt(): Promise<{ bridge: BridgeHandle; root: string }> {
	root = await mkdtemp(join(tmpdir(), "crust-wiring-"));
	configureLogger({ root, level: "info" });
	const started = startBridge({
		handlers: [plugin],
		security: {
			capabilities: [{ name: "grant", actions: ["test:echo"] }],
			grants: { [DEFAULT_WINDOW_LABEL]: ["grant"] },
		},
	});
	bridge = started;
	return { bridge: started, root };
}

function call(target: BridgeHandle, command: string): Promise<Response> {
	return fetch(`${target.url}/_crust/invoke`, {
		method: "POST",
		headers: {
			origin: target.url,
			authorization: `Bearer ${target.token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ plugin: "test", command, args: {}, window: DEFAULT_WINDOW_LABEL }),
	});
}

async function fileRecords(at: string): Promise<{ text: string; records: LogRecord[] }> {
	const text = await readFile(join(at, "logs", "app.jsonl"), "utf8");
	const records = text
		.split("\n")
		.filter(Boolean)
		.map((line) => parseLine(line))
		.filter((line): line is LogRecord => line !== undefined && !("raw" in line));
	return { text, records };
}

describe("bridge wiring", () => {
	test("invokes, a capability refusal and a page error all reach app.jsonl", async () => {
		const { bridge: started, root: at } = await startAt();

		expect((await call(started, "echo")).status).toBe(200);
		expect((await call(started, "refuse")).status).toBe(403);

		const pageLog = await fetch(`${started.url}/_crust/log`, {
			method: "POST",
			headers: {
				origin: started.url,
				authorization: `Bearer ${started.token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				kind: "error",
				message: "boom from the page",
				stack: "Error: boom\n  at app.js:1",
				url: "http://h/app.js",
				line: 1,
				col: 1,
			}),
		});
		expect(pageLog.status).toBe(204);

		await flushLogger();
		const { text, records } = await fileRecords(at);

		const invokes = records.filter((record) => record.event === "bridge.invoke");
		const ok = invokes.find((record) => record.ok === true);
		const failed = invokes.find((record) => record.ok === false);
		expect(ok?.code).toBeUndefined();
		expect(typeof ok?.durMs).toBe("number");
		expect(failed?.code).toBe("forbidden");
		expect(typeof failed?.durMs).toBe("number");
		expect(failed?.ns).toBe("test");
		expect(failed?.cmd).toBe("refuse");
		expect(failed?.window).toBe(DEFAULT_WINDOW_LABEL);

		const refuse = records.find((record) => record.event === "bridge.refuse");
		expect(refuse?.reason).toBe("capability");

		const page = records.find((record) => record.event === "page.error");
		expect(page?.message).toBe("boom from the page");
		expect(page?.level).toBe("error");

		// hunt-50's other half: the credential never reaches the file, not in a field and not in a message.
		expect(text).not.toContain(started.token);
	});
});
