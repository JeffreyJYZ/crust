import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { type ShellHarness, shellHarness } from "@/plugins/shell-fixture";
import {
	type KillOutcome,
	type ListOutcome,
	type OutputOutcome,
	createLineRing,
} from "@/plugins/shell";

let h: ShellHarness;

beforeEach(async () => {
	h = await shellHarness();
});

afterEach(async () => {
	await h.stop();
});

describe("shell.spawn", () => {
	test("captures stdout and the exit code", async () => {
		const out = await h.settled(await h.id({ program: "echo", args: ["hello"] }));
		expect(out).toEqual({ ok: true, stdout: "hello", stderr: "", exitCode: 0, signal: null });
	});

	test("passes argv verbatim, never through a shell", async () => {
		const out = await h.settled(
			await h.id({ program: "echo", args: ["a; rm -rf /", "$HOME"] }),
		);
		expect(out.stdout).toBe("a; rm -rf / $HOME");
	});

	test("runs with a cwd inside the root", async () => {
		const out = await h.settled(await h.id({ program: "echo", args: ["here"], cwd: "." }));
		expect(out).toEqual({ ok: true, stdout: "here", stderr: "", exitCode: 0, signal: null });
	});

	test("refuses a program outside the allow list and names it", async () => {
		expect(await h.spawn({ program: "rm" })).toMatchObject({
			ok: false,
			code: "program-not-allowed",
			message: expect.stringContaining("rm"),
		});
	});

	test("refuses a path that resolves outside cwdRoot", async () => {
		expect(await h.spawn({ program: "/bin/echo" })).toMatchObject({
			ok: false,
			code: "program-outside-root",
		});
	});

	test("refuses a cwd outside cwdRoot", async () => {
		expect(await h.spawn({ program: "echo", cwd: "/" })).toMatchObject({
			ok: false,
			code: "cwd-not-allowed",
		});
	});

	test("an allowed path inside cwdRoot is passed through, and a missing one is typed", async () => {
		expect(await h.spawn({ program: "./bin/tool" })).toMatchObject({
			ok: false,
			code: "spawn-failed",
		});
	});

	test("a missing program is a typed failure, not a throw", async () => {
		expect(await h.spawn({ program: "crust-no-such-program" })).toMatchObject({
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
			expect(await h.spawn(payload)).toMatchObject({ ok: false, code: "invalid-args" });
		}
	});
});

describe("shell.kill", () => {
	test("kills a live process, and a second kill reports it was already gone", async () => {
		const child = await h.id({ program: "sleep", args: ["0.1"] });
		expect(await h.call<KillOutcome>("kill", { id: child })).toEqual({
			ok: true,
			killed: true,
			id: child,
		});
		expect((await h.settled(child)).signal).toBe("SIGTERM");
		expect(await h.call<KillOutcome>("kill", { id: child })).toMatchObject({
			ok: true,
			killed: false,
		});
	});
});

describe("shell.list", () => {
	test("lists a live id and drops it once it exits", async () => {
		const child = await h.id({ program: "sleep", args: ["0.1"] });
		expect(await h.call<ListOutcome>("list", {})).toEqual({ ok: true, ids: [child] });
		await h.settled(child);
		expect(await h.call<ListOutcome>("list", {})).toEqual({ ok: true, ids: [] });
	});
});

describe("shell refusals", () => {
	test("an unknown id is typed for output and kill", async () => {
		expect(await h.call<OutputOutcome>("output", { id: "nope" })).toMatchObject({
			ok: false,
			code: "unknown-process",
		});
		expect(await h.call<KillOutcome>("kill", { id: "nope" })).toMatchObject({
			ok: false,
			code: "unknown-process",
		});
		expect(await h.call<OutputOutcome>("output", {})).toMatchObject({
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

	test("answers a kept line while the ring has room, and nothing once it is full", () => {
		const ring = createLineRing(2);
		expect(ring.push("a")).toBe("a");
		expect(ring.push("b")).toBe("b");
		expect(ring.push("c")).toBeUndefined();
	});
});
