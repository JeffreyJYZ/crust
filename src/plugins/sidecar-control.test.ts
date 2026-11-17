import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSidecarPlugin } from "./sidecar";
import { fakeSidecar, type FakeSidecar } from "./sidecar-fake";
import type { SidecarExit } from "./sidecar-types";

let root: string;
let fake: FakeSidecar;
let seen: Array<{ event: string; data: unknown }>;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "crust-sidecar-ctl-"));
	await writeFile(join(root, "tool"), "", { mode: 0o644 });
	fake = fakeSidecar();
	seen = [];
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function plugin(extra: { killGraceMs?: number } = {}) {
	const p = createSidecarPlugin({
		names: ["tool"],
		dir: root,
		spawn: fake.spawn,
		...extra,
	});
	type Handler = (args: unknown, ctx: unknown) => Promise<unknown>;
	const table = p.commands as unknown as Record<"spawn" | "write" | "list" | "kill", Handler>;
	const ctx = { emit: (event: string, data: unknown) => seen.push({ event, data }) };
	return {
		spawn: (args: unknown) => table.spawn(args, ctx),
		write: (args: unknown) => table.write(args, ctx),
		list: () => table.list({}, ctx),
		kill: (args: unknown) => table.kill(args, ctx),
	};
}

const tick = (ms = 0) => new Promise((done) => setTimeout(done, ms));

describe("sidecar.write", () => {
	test("feeds text to the child's stdin pipe", async () => {
		const p = plugin();
		const spawned = (await p.spawn({ name: "tool" })) as { id: string };
		const result = await p.write({ id: spawned.id, data: "hello\n" });
		expect(result).toMatchObject({ ok: true, id: spawned.id, bytes: 6 });
		expect(fake.written()).toBe("hello\n");
	});

	test("accepts Uint8Array bytes and Butter's { text } alias", async () => {
		const p = plugin();
		const spawned = (await p.spawn({ name: "tool" })) as { id: string };
		await p.write({ id: spawned.id, data: new Uint8Array([65, 66]) });
		await p.write({ id: spawned.id, text: "C" });
		expect(fake.written()).toBe("ABC");
	});

	test("an unknown id is a typed failure naming it, never a silent no-op", async () => {
		const result = await plugin().write({ id: "nope", data: "x" });
		expect(result).toMatchObject({ ok: false, code: "sidecar-unknown-id" });
		expect((result as { message: string }).message).toContain("nope");
	});
});

describe("sidecar.list", () => {
	test("returns every live child with id, name, pid and startedAt", async () => {
		const p = plugin();
		const before = Date.now();
		const spawned = (await p.spawn({ name: "tool" })) as { id: string; pid: number };
		const result = await p.list();
		expect(result).toMatchObject({ ok: true, names: ["tool"] });
		const children = (result as { children: Array<Record<string, unknown>> }).children;
		expect(children).toHaveLength(1);
		expect(children[0]).toMatchObject({
			id: spawned.id,
			name: "tool",
			pid: 4242,
		});
		expect(children[0]?.startedAt as number).toBeGreaterThanOrEqual(before);
	});

	test("a child disappears from list once it exits", async () => {
		const p = plugin();
		await p.spawn({ name: "tool" });
		await fake.exit(0);
		await tick();
		const result = await p.list();
		expect((result as { children: unknown[] }).children).toHaveLength(0);
	});
});

describe("sidecar.kill", () => {
	test("SIGTERM fires the exit event exactly once", async () => {
		const p = plugin();
		const spawned = (await p.spawn({ name: "tool" })) as { id: string };
		expect(await p.kill({ id: spawned.id })).toMatchObject({ ok: true });
		expect(fake.signals).toEqual(["SIGTERM"]);
		await tick();
		const exits = seen.filter((s) => s.event === "sidecar-exit");
		expect(exits).toHaveLength(1);
		expect(exits[0]?.data).toMatchObject({
			id: spawned.id,
			signal: "SIGTERM",
		} satisfies Partial<SidecarExit>);
	});

	test("a child that ignores SIGTERM gets SIGKILL after the grace", async () => {
		const stubborn = fakeSidecar(4242, { ignoreSigterm: true });
		fake = stubborn;
		const p = plugin({ killGraceMs: 10 });
		const spawned = (await p.spawn({ name: "tool" })) as { id: string };
		await p.kill({ id: spawned.id });
		await tick(40);
		expect(stubborn.signals).toEqual(["SIGTERM", "SIGKILL"]);
		expect(seen.filter((s) => s.event === "sidecar-exit")).toHaveLength(1);
	});

	test("an unknown id is a typed failure naming it", async () => {
		const result = await plugin().kill({ id: "ghost" });
		expect(result).toMatchObject({ ok: false, code: "sidecar-unknown-id" });
		expect((result as { message: string }).message).toContain("ghost");
	});
});
