/**
 * `sidecar.kill` must not claim a kill for a child that had already departed. A real `Bun.spawn`
 * child reports the exit on `exitCode`/`signalCode` a moment before the exit event prunes the
 * record, so the window is reachable; the stand-ins below hold it open deterministically.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSidecarPlugin } from "./sidecar";
import type { SidecarChild } from "./sidecar-types";

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "crust-sidecar-kill-"));
	await writeFile(join(root, "tool"), "", { mode: 0o644 });
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

/** A child whose `exited` never settles, so the exit handler cannot prune the record under the test. */
function stuck(code: number | null, signal: number | string | null, kills: string[]) {
	const child: SidecarChild = {
		pid: 999,
		stdin: null,
		stdout: null,
		stderr: null,
		exited: new Promise<number>(() => {}),
		exitCode: code,
		signalCode: signal,
		kill(sig) {
			kills.push(String(sig ?? "SIGTERM"));
			// The test controls when (or whether) this child becomes departed.
		},
	};
	return child;
}

describe("sidecar.kill on a departed child", () => {
	test("answers killed:false, sends no signal and prunes the record", async () => {
		const kills: string[] = [];
		const p = createSidecarPlugin({
			names: ["tool"],
			dir: root,
			spawn: () => stuck(0, null, kills),
		});
		const ctx = { emit: () => {} };
		const spawned = (await p.commands.spawn({ name: "tool" }, ctx)) as { id: string };
		const answer = await p.commands.kill({ id: spawned.id }, ctx);
		expect(answer).toMatchObject({ ok: true, killed: false, id: spawned.id });
		expect(kills).toEqual([]);
		expect(await p.commands.list({}, ctx)).toMatchObject({ children: [] });
	});

	test("the grace timer prunes a child that departed instead of re-killing it", async () => {
		const kills: string[] = [];
		const child = stuck(null, null, kills);
		const p = createSidecarPlugin({
			names: ["tool"],
			dir: root,
			spawn: () => child,
			killGraceMs: 10,
		});
		const ctx = { emit: () => {} };
		const spawned = (await p.commands.spawn({ name: "tool" }, ctx)) as { id: string };
		// A signal was sent; the child then exits but its `exited` promise has not settled, so the
		// record is still live when the grace timer fires.
		const signaled = (await p.commands.kill({ id: spawned.id }, ctx)) as { killed: boolean };
		expect(signaled.killed).toBe(true);
		Object.defineProperty(child, "signalCode", { value: "SIGTERM", configurable: true });
		await Bun.sleep(40);
		expect(kills).toEqual(["SIGTERM"]);
		expect(await p.commands.list({}, ctx)).toMatchObject({ children: [] });
	});
});
