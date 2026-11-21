/**
 * The incident: a `shell.spawn` program outlived crust. The plugin killed a child only when the page
 * asked, while `app.quit()` and a `crust dev` restart (`SIGTERM`) both just end the process, so every
 * running program was reparented to launchd and kept running beside the next start.
 * Each case runs a real app in a real process: the child ignores `SIGTERM`, so only the exit pass can
 * end it, and the assertion is that its pid is gone.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = import.meta.dir;
const pluginModule = join(source, "shell.ts");
const appModule = join(source, "..", "app.ts");
const runtimeModule = join(source, "..", "runtime-process.ts");

const q = (value: string): string => JSON.stringify(value);

/** A child that traps SIGTERM: only SIGKILL can end it, which is what makes the reap load-bearing. */
const childCommand = (pidFile: string): string =>
	`echo $$ > ${q(pidFile)}; trap '' TERM; exec sleep 60`;

/**
 * The app under test, run as its own process: `quit` mounts the shell plugin on a real `App` and calls
 * `app.quit()` on a platform whose quit mirrors darwin's `process.exit(0)`; `term` takes the
 * `crust dev` path, where `runtime-process.ts` turns the restart signal into `process.exit(0)`.
 */
function harness(mode: "quit" | "term", paths: { root: string; pidFile: string }): string {
	const setup = `const plugin = createShellPlugin({ allow: ["/bin/sh"], cwdRoot: ${q(paths.root)} });
const outcome = await plugin.commands.spawn(
	{ program: "/bin/sh", args: ["-c", ${q(childCommand(paths.pidFile))}] },
	{ emit: () => {} },
);
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
import { createShellPlugin } from ${q(pluginModule)};
${imports}
${setup}
${finish}
await new Promise(() => {});`;
}

const sleep = (ms: number): Promise<void> => Bun.sleep(ms);

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

async function start(mode: "quit" | "term"): Promise<{
	app: Bun.Subprocess<"ignore", "pipe", "pipe">;
	pid: number;
	dir: string;
}> {
	const dir = await mkdtemp(join(tmpdir(), `crust-reap-${mode}-`));
	const pidFile = join(dir, "child.pid");
	const script = join(dir, "harness.ts");
	await writeFile(script, harness(mode, { root: dir, pidFile }));
	const app = Bun.spawn({
		cmd: [process.execPath, script],
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

describe("shell children are reaped when crust leaves", () => {
	test("app.quit() kills a child that ignores SIGTERM", async () => {
		const { app, pid, dir } = await start("quit");
		await ended(app);
		expect(await gone(pid)).toBe(true);
		await rm(dir, { recursive: true, force: true });
	}, 15000);

	test("SIGTERM, the crust dev restart signal, kills the same child", async () => {
		const { app, pid, dir } = await start("term");
		app.kill("SIGTERM");
		await ended(app);
		expect(await gone(pid)).toBe(true);
		await rm(dir, { recursive: true, force: true });
	}, 15000);
});
