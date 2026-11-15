import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { type ShellHarness, shellHarness } from "@/plugins/shell-fixture";
import type { CloseOutcome, ListOutcome, SpawnOutcome, WriteOutcome } from "@/plugins/shell";

let h: ShellHarness;

beforeEach(async () => {
	h = await shellHarness();
});

afterEach(async () => {
	await h.stop();
});

describe("shell.spawn stdin", () => {
	test("a pipe takes written text, and close ends it without a kill", async () => {
		const child = await h.id({ program: "cat", stdin: "pipe" });
		expect(await h.call<WriteOutcome>("write", { id: child, data: "hello\n" })).toEqual({
			ok: true,
			bytes: 6,
		});
		expect(await h.call<CloseOutcome>("close", { id: child })).toEqual({
			ok: true,
			closed: true,
			id: child,
		});
		expect(await h.settled(child)).toEqual({
			ok: true,
			stdout: "hello",
			stderr: "",
			exitCode: 0,
			signal: null,
		});
	});

	test("bytes counts UTF-8 bytes, not characters", async () => {
		const child = await h.id({ program: "cat", stdin: "pipe" });
		expect(await h.call<WriteOutcome>("write", { id: child, data: "é\n" })).toEqual({
			ok: true,
			bytes: 3,
		});
		await h.call<CloseOutcome>("close", { id: child });
		expect((await h.settled(child)).stdout).toBe("é");
	});

	test("writing to a process without a pipe is no-stdin", async () => {
		const child = await h.id({ program: "sleep", args: ["0.1"] });
		expect(await h.call<WriteOutcome>("write", { id: child, data: "x" })).toMatchObject({
			ok: false,
			code: "no-stdin",
		});
		await h.settled(child);
	});

	test("writing after close is no-stdin", async () => {
		const child = await h.id({ program: "cat", stdin: "pipe" });
		await h.call<CloseOutcome>("close", { id: child });
		expect(await h.call<WriteOutcome>("write", { id: child, data: "x" })).toMatchObject({
			ok: false,
			code: "no-stdin",
		});
		await h.settled(child);
	});

	test("write refuses an unknown id and a bad payload", async () => {
		expect(await h.call<WriteOutcome>("write", { id: "nope", data: "x" })).toMatchObject({
			ok: false,
			code: "unknown-process",
		});
		for (const payload of [{}, { id: "x" }, { id: "", data: "x" }, { id: "x", data: 1 }]) {
			expect(await h.call<WriteOutcome>("write", payload)).toMatchObject({
				ok: false,
				code: "invalid-args",
			});
		}
	});

	test("close without a pipe is a no-op, not a kill", async () => {
		const child = await h.id({ program: "sleep", args: ["0.1"] });
		expect(await h.call<CloseOutcome>("close", { id: child })).toEqual({
			ok: true,
			closed: false,
			id: child,
		});
		expect(await h.call<ListOutcome>("list", {})).toEqual({ ok: true, ids: [child] });
		await h.settled(child);
	});

	test("close refuses an unknown id and a bad payload", async () => {
		expect(await h.call<CloseOutcome>("close", { id: "nope" })).toMatchObject({
			ok: false,
			code: "unknown-process",
		});
		expect(await h.call<CloseOutcome>("close", {})).toMatchObject({
			ok: false,
			code: "invalid-args",
		});
	});

	test("a stdin value that is neither pipe nor ignore is invalid-args", async () => {
		expect(await h.spawn({ program: "echo", stdin: "inherit" })).toMatchObject({
			ok: false,
			code: "invalid-args",
		});
	});
});

describe("shell streaming", () => {
	test("emits one shell-output per stdout line as it arrives", async () => {
		const { ctx, seen } = h.recorder();
		const spawned = await h.spawnWith({ program: "cat", stdin: "pipe" }, ctx);
		if (!spawned.ok) throw new Error(spawned.message);
		await h.callWith("write", { id: spawned.id, data: "one\ntwo\n" }, ctx);
		await h.callWith("close", { id: spawned.id }, ctx);
		await h.settled(spawned.id);
		expect(seen).toEqual([
			{ event: "shell-output", data: { id: spawned.id, stream: "stdout", line: "one" } },
			{ event: "shell-output", data: { id: spawned.id, stream: "stdout", line: "two" } },
		]);
	});

	test("a line on stderr carries stream: stderr", async () => {
		const { ctx, seen } = h.recorder();
		const spawned = await h.spawnWith({ program: "cat", args: ["nope.txt"] }, ctx);
		if (!spawned.ok) throw new Error(spawned.message);
		expect((await h.settled(spawned.id)).exitCode).toBe(1);
		expect(seen.length).toBe(1);
		expect(seen[0]?.event).toBe("shell-output");
		expect(seen[0]?.data.stream).toBe("stderr");
		expect(seen[0]?.data.line).toContain("nope.txt");
	});

	test("emits at most the ring's 500 lines per stream", async () => {
		const { ctx, seen } = h.recorder();
		const spawned = await h.spawnWith({ program: "cat", stdin: "pipe" }, ctx);
		if (!spawned.ok) throw new Error(spawned.message);
		const text = `${Array.from({ length: 600 }, (_, n) => `n-${n}`).join("\n")}\n`;
		await h.callWith("write", { id: spawned.id, data: text }, ctx);
		await h.callWith("close", { id: spawned.id }, ctx);
		const out = await h.settled(spawned.id);
		expect(seen.length).toBe(500);
		expect(seen[0]?.data.line).toBe("n-0");
		expect(seen[499]?.data.line).toBe("n-499");
		const kept = out.stdout.split("\n");
		expect(kept.length).toBe(500);
		expect(kept[0]).toBe("n-100");
	});

	test("a spawn without a context still records output, and emits nothing", async () => {
		const out = await h.settled(await h.id({ program: "echo", args: ["quiet"] }));
		expect(out.stdout).toBe("quiet");
	});
});

describe("the allowlist still refuses first", () => {
	test("program-not-allowed fires before any process exists, with stdin: pipe too", async () => {
		expect(
			await h.spawn({ program: "sh", args: ["-c", "echo hi"], stdin: "pipe" }),
		).toMatchObject({
			ok: false,
			code: "program-not-allowed",
		});
		expect(await h.call<ListOutcome>("list", {})).toEqual({ ok: true, ids: [] });
	});
});
