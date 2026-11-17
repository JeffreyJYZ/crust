import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type SidecarExit, type SidecarStdout, createSidecarPlugin } from "./sidecar";
import { fakeSidecar, type FakeSidecar } from "./sidecar-fake";

let root: string;
let fake: FakeSidecar;
let seen: Array<{ event: string; data: unknown }>;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "crust-sidecar-"));
	await writeFile(join(root, "tool"), "", { mode: 0o644 });
	fake = fakeSidecar();
	seen = [];
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function plugin(names: string[] = ["tool"]) {
	const p = createSidecarPlugin({ names, dir: root, spawn: fake.spawn });
	const table = p.commands as unknown as Record<
		string,
		(args: unknown, ctx: unknown) => Promise<unknown>
	>;
	const spawn = table.spawn;
	if (!spawn) throw new Error("sidecar plugin has no spawn command");
	return {
		spawn: (args: unknown) =>
			spawn(args, {
				emit: (event: string, data: unknown) => seen.push({ event, data }),
			}),
	};
}

describe("sidecar.spawn refusals", () => {
	test("an undeclared name is a typed failure naming it", async () => {
		const result = await plugin().spawn({ name: "sh" });
		expect(result).toMatchObject({ ok: false, code: "sidecar-not-declared" });
		expect((result as { message: string }).message).toContain("sh");
	});

	test("a declared name whose binary is missing on disk is a typed failure", async () => {
		const result = await plugin(["gone"]).spawn({ name: "gone" });
		expect(result).toMatchObject({ ok: false, code: "sidecar-missing" });
		expect((result as { message: string }).message).toContain("gone");
	});

	test("a path that escapes the bundle is refused by name", async () => {
		const result = await plugin(["../outside"]).spawn({ name: "../outside" });
		expect(result).toMatchObject({ ok: false, code: "sidecar-path-escape" });
	});

	test("a non-string name is invalid-args", async () => {
		expect(await plugin().spawn({ name: 7 })).toMatchObject({
			ok: false,
			code: "invalid-args",
		});
	});
});

describe("sidecar.spawn streaming", () => {
	test("spawn returns the pid and streams stdout and stderr as events", async () => {
		const result = await plugin().spawn({ name: "tool", args: ["--version"] });
		expect(result).toMatchObject({ ok: true, pid: 4242 });
		expect(fake.calls[0]?.[0]).toBe(join(root, "tool"));
		expect(fake.calls[0]).toEqual([join(root, "tool"), "--version"]);
		fake.out("hello\n");
		fake.err("warn\n");
		await new Promise((done) => setTimeout(done, 0));
		const texts = seen
			.filter((s) => s.event === "sidecar-stdout")
			.map((s) => (s.data as SidecarStdout).text);
		expect(texts.join("")).toContain("hello");
		expect(texts.join("")).toContain("warn");
		await fake.exit(0);
	});

	test("a process that exits mid-stream still emits sidecar-exit", async () => {
		const result = await plugin().spawn({ name: "tool" });
		const id = (result as { id: string }).id;
		fake.out("partial");
		await fake.exit(3);
		await new Promise((done) => setTimeout(done, 0));
		const exit = seen.find((s) => s.event === "sidecar-exit");
		expect(exit).toBeDefined();
		expect(exit?.data).toMatchObject({
			id,
			name: "tool",
			code: 3,
			signal: null,
		} satisfies Partial<SidecarExit>);
	});

	test("a signal ends the process with a signal and no exit code", async () => {
		await plugin().spawn({ name: "tool" });
		await fake.signal("SIGTERM");
		await new Promise((done) => setTimeout(done, 0));
		const exit = seen.find((s) => s.event === "sidecar-exit");
		expect(exit?.data).toMatchObject({ code: null, signal: "SIGTERM" });
	});
});
