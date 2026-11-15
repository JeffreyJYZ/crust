import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PluginDefinition } from "@/plugins/define";
import {
	type KillOutcome,
	type ListOutcome,
	type OutputOutcome,
	type ShellCommands,
	type SpawnOutcome,
	createLineRing,
	createShellPlugin,
} from "@/plugins/shell";

let plugin: PluginDefinition<"shell", ShellCommands>;
let root: string;
const started: string[] = [];

async function call<T>(name: string, args: unknown): Promise<T> {
	const table = plugin.commands as unknown as Record<
		string,
		(input: unknown) => Promise<unknown>
	>;
	const handler = table[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return (await handler(args)) as T;
}

async function spawn(args: unknown): Promise<SpawnOutcome> {
	const result = await call<SpawnOutcome>("spawn", args);
	if (result.ok) started.push(result.id);
	return result;
}

/** Spawn, or fail the test with the refusal's own message. */
async function id(args: unknown): Promise<string> {
	const result = await spawn(args);
	if (!result.ok) throw new Error(`spawn refused: ${result.message}`);
	return result.id;
}

/** Read until the process is gone; `output` waits for the drain once it is. */
async function settled(child: string): Promise<Extract<OutputOutcome, { ok: true }>> {
	const deadline = Date.now() + 4000;
	for (;;) {
		const out = await call<OutputOutcome>("output", { id: child });
		if (!out.ok) throw new Error(out.message);
		if (out.exitCode !== null || out.signal !== null) return out;
		if (Date.now() > deadline) throw new Error(`process ${child} did not exit`);
		await Bun.sleep(10);
	}
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "crust-shell-"));
	plugin = createShellPlugin({
		allow: ["echo", "true", "sleep", "tool", "crust-no-such-program"],
		cwdRoot: root,
	});
});

afterEach(async () => {
	for (const child of started) await call("kill", { id: child });
	started.length = 0;
	await rm(root, { recursive: true, force: true });
});

describe("shell.spawn", () => {
	test("captures stdout and the exit code", async () => {
		const out = await settled(await id({ program: "echo", args: ["hello"] }));
		expect(out).toEqual({ ok: true, stdout: "hello", stderr: "", exitCode: 0, signal: null });
	});

	test("passes argv verbatim, never through a shell", async () => {
		const out = await settled(await id({ program: "echo", args: ["a; rm -rf /", "$HOME"] }));
		expect(out.stdout).toBe("a; rm -rf / $HOME");
	});

	test("runs with a cwd inside the root", async () => {
		const out = await settled(await id({ program: "echo", args: ["here"], cwd: "." }));
		expect(out).toEqual({ ok: true, stdout: "here", stderr: "", exitCode: 0, signal: null });
	});

	test("refuses a program outside the allow list and names it", async () => {
		expect(await spawn({ program: "rm" })).toMatchObject({
			ok: false,
			code: "program-not-allowed",
			message: expect.stringContaining("rm"),
		});
	});

	test("refuses a path that resolves outside cwdRoot", async () => {
		expect(await spawn({ program: "/bin/echo" })).toMatchObject({
			ok: false,
			code: "program-outside-root",
		});
	});

	test("refuses a cwd outside cwdRoot", async () => {
		expect(await spawn({ program: "echo", cwd: "/" })).toMatchObject({
			ok: false,
			code: "cwd-not-allowed",
		});
	});

	test("an allowed path inside cwdRoot is passed through, and a missing one is typed", async () => {
		expect(await spawn({ program: "./bin/tool" })).toMatchObject({
			ok: false,
			code: "spawn-failed",
		});
	});

	test("a missing program is a typed failure, not a throw", async () => {
		expect(await spawn({ program: "crust-no-such-program" })).toMatchObject({
			ok: false,
			code: "spawn-failed",
			message: expect.stringContaining("crust-no-such-program"),
		});
	});

	test("a bad payload is invalid-args", async () => {
		for (const payload of [
			{},
			{ program: "" },
			{ program: 7 },
			{ program: "echo", args: "x" },
			{ program: "echo", args: [1] },
			{ program: "echo", cwd: 2 },
			{ program: "echo", env: { A: 1 } },
			{ program: "echo", env: ["A"] },
		]) {
			expect(await spawn(payload)).toMatchObject({ ok: false, code: "invalid-args" });
		}
	});
});

describe("shell.kill", () => {
	test("kills a live process, and a second kill reports it was already gone", async () => {
		const child = await id({ program: "sleep", args: ["0.1"] });
		expect(await call<KillOutcome>("kill", { id: child })).toEqual({
			ok: true,
			killed: true,
			id: child,
		});
		expect((await settled(child)).signal).toBe("SIGTERM");
		expect(await call<KillOutcome>("kill", { id: child })).toMatchObject({
			ok: true,
			killed: false,
		});
	});
});

describe("shell.list", () => {
	test("lists a live id and drops it once it exits", async () => {
		const child = await id({ program: "sleep", args: ["0.1"] });
		expect(await call<ListOutcome>("list", {})).toEqual({ ok: true, ids: [child] });
		await settled(child);
		expect(await call<ListOutcome>("list", {})).toEqual({ ok: true, ids: [] });
	});
});

describe("shell refusals", () => {
	test("an unknown id is typed for output and kill", async () => {
		expect(await call<OutputOutcome>("output", { id: "nope" })).toMatchObject({
			ok: false,
			code: "unknown-process",
		});
		expect(await call<KillOutcome>("kill", { id: "nope" })).toMatchObject({
			ok: false,
			code: "unknown-process",
		});
		expect(await call<OutputOutcome>("output", {})).toMatchObject({
			ok: false,
			code: "invalid-args",
		});
	});
});

describe("the output ring", () => {
	test("keeps the last N lines", () => {
		const ring = createLineRing(3);
		for (const n of [1, 2, 3, 4, 5]) ring.push(`line-${n}`);
		expect(ring.lines()).toEqual(["line-3", "line-4", "line-5"]);
	});

	test("keeps 500 lines by default", () => {
		const ring = createLineRing();
		for (let n = 0; n < 600; n++) ring.push(`n-${n}`);
		const kept = ring.lines();
		expect(kept.length).toBe(500);
		expect(kept[0]).toBe("n-100");
	});
});
