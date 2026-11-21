/**
 * The same incident as `shell-reap.test.ts`, on the other plugin: a `sidecar.spawn` daemon was ended
 * only by `sidecar.kill`, while `app.quit()` and a `crust dev` restart (`SIGTERM`) just end the
 * process, so the daemon was reparented to launchd and kept running beside the next start.
 * Each case runs a real app in a real process against a real binary: the child ignores `SIGTERM`, so
 * only the reap can end it, and the assertion is that its pid is gone.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSidecarPlugin } from "./sidecar";

const source = import.meta.dir;
const pluginModule = join(source, "sidecar.ts");
const appModule = join(source, "..", "app.ts");
const runtimeModule = join(source, "..", "runtime-process.ts");

const q = (value: string): string => JSON.stringify(value);

/** A child that traps SIGTERM: only SIGKILL can end it, which is what makes the reap load-bearing. */
const stubborn = (pidFile: string): string =>
	`#!/bin/sh\necho $$ > ${q(pidFile)}\ntrap '' TERM\nexec sleep 60\n`;

/** A child that answers SIGTERM normally, so `sidecar.kill` has something to still do. */
const polite = (pidFile: string): string =>
	`#!/bin/sh\necho $$ > ${q(pidFile)}\ntrap 'exit 0' TERM\nwhile :; do sleep 0.1; done\n`;

type Mode = "quit" | "term";

/**
 * The app under test, run as its own process: `quit` mounts the sidecar plugin on a real `App` and
 * calls `app.quit()` on a platform whose quit mirrors darwin's `process.exit(0)`; `term` takes the
 * `crust dev` path, where `runtime-process.ts` turns the restart signal into `process.exit(0)`.
 */
function harness(mode: Mode, paths: { root: string; pidFile: string }): string {
	const setup = `const plugin = createSidecarPlugin({ dir: ${q(paths.root)}, names: ["tool"] });
const outcome = await plugin.commands.spawn({ name: "tool" }, { emit: () => {} });
if (!outcome.ok) throw new Error(outcome.message);
// Let the child write its pid before the quit below, or the quit races its own start.
const spawned = Date.now() + 4000;
while (!existsSync(${q(paths.pidFile)})) {
	if (Date.now() > spawned) throw new Error("the child never wrote its pid");
	await Bun.sleep(10);
}`;
	const finish =
		mode === "quit"
			? `const platform = { quit: () => process.exit(0) };
new App().attach(platform as never, {} as never).quit();`
			: "registerShutdownSignals();";
	const imports =
		mode === "quit"
			? `import { App } from ${q(appModule)};`
			: `import { registerShutdownSignals } from ${q(runtimeModule)};`;
	return `import { existsSync } from "node:fs";
import { createSidecarPlugin } from ${q(pluginModule)};
${imports}
${setup}
${finish}
await new Promise(() => {});`;
}

const sleep = (ms: number): Promise<void> => Bun.sleep(ms);

/** Poll for the pid file a fresh child writes before it installs its TERM trap. */
async function waitForPid(pidFile: string, budgetMs = 5000): Promise<number> {
	const deadline = Date.now() + budgetMs;
	while (!existsSync(pidFile)) {
		if (Date.now() > deadline) throw new Error("the child never wrote its pid");
		await sleep(10);
	}
	return Number((await readFile(pidFile, "utf8")).trim());
}

/** Poll for a pid to disappear; a zombie is reaped by the kernel's orphan handling shortly after. */
async function gone(pid: number, budgetMs = 5000): Promise<boolean> {
	const deadline = Date.now() + budgetMs;
	for (;;) {
		try {
			process.kill(pid, 0);
		} catch {
			return true;
		}
		if (Date.now() > deadline) return false;
		await sleep(20);
	}
}

/** Write a real executable sidecar and the app that spawns it; answer both paths and its pid. */
async function stage(
	mode: Mode,
	script: (pidFile: string) => string,
): Promise<{
	app: Bun.Subprocess<"ignore", "pipe", "pipe">;
	pid: number;
	dir: string;
}> {
	const dir = await mkdtemp(join(tmpdir(), `crust-sidecar-reap-${mode}-`));
	const pidFile = join(dir, "child.pid");
	await writeFile(join(dir, "tool"), script(pidFile), { mode: 0o755 });
	const harnessFile = join(dir, "harness.ts");
	await writeFile(harnessFile, harness(mode, { root: dir, pidFile }));
	const app = Bun.spawn({
		cmd: [process.execPath, harnessFile],
		cwd: dir,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const deadline = Date.now() + 8000;
	while (!existsSync(pidFile) || (await readFile(pidFile, "utf8")).trim().length === 0) {
		if (Date.now() > deadline) throw new Error(`the harness never spawned its child (${mode})`);
		await sleep(20);
	}
	const pid = Number((await readFile(pidFile, "utf8")).trim());
	expect(pid).toBeGreaterThan(0);
	return { app, pid, dir };
}

async function ended(app: Bun.Subprocess<"ignore", "pipe", "pipe">): Promise<void> {
	const code = await Promise.race([app.exited, sleep(8000).then(() => "timeout" as const)]);
	if (code === "timeout") throw new Error("the app did not exit");
}

describe("sidecar children are reaped when crust leaves", () => {
	test("app.quit() kills a sidecar that ignores SIGTERM", async () => {
		const { app, pid, dir } = await stage("quit", stubborn);
		await ended(app);
		expect(await gone(pid)).toBe(true);
		await rm(dir, { recursive: true, force: true });
	}, 15000);

	test("SIGTERM, the crust dev restart signal, kills the same child", async () => {
		const { app, pid, dir } = await stage("term", stubborn);
		app.kill("SIGTERM");
		await ended(app);
		expect(await gone(pid)).toBe(true);
		await rm(dir, { recursive: true, force: true });
	}, 15000);
});

describe("sidecar.kill is unchanged by the reap", () => {
	test("answers exactly { ok, id } once and leaves the child dead", async () => {
		const dir = await mkdtemp(join(tmpdir(), "crust-sidecar-kill-"));
		const pidFile = join(dir, "child.pid");
		await writeFile(join(dir, "tool"), polite(pidFile), { mode: 0o755 });
		const events: string[] = [];
		const plugin = createSidecarPlugin({
			dir,
			names: ["tool"],
			killGraceMs: 100,
		});
		const ctx = { emit: (event: string) => events.push(event) };
		const spawned = await plugin.commands.spawn({ name: "tool" }, ctx as never);
		if (!spawned.ok) throw new Error(spawned.message);
		const pid = await waitForPid(pidFile);
		const result = await plugin.commands.kill({ id: spawned.id }, ctx as never);
		expect(result).toEqual({ ok: true, id: spawned.id });
		expect(await gone(pid)).toBe(true);
		// The grace timer must not fire a second kill, so exactly one exit arrives even after it.
		await sleep(200);
		expect(events.filter((event) => event === "sidecar-exit")).toHaveLength(1);
		const again = await plugin.commands.kill({ id: spawned.id }, ctx as never);
		expect(again).toMatchObject({ ok: false, code: "sidecar-unknown-id" });
		await rm(dir, { recursive: true, force: true });
	}, 15000);
});
