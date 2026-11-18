/**
 * The darwin disarm adapter's honesty, pinned without arming real signal handlers.
 * `unit()` is module-level and not injectable, so the C answer is replaced on the compiled unit
 * that exported seam returns; the compile refusal runs in a child with an isolated `TMPDIR`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CrashArm } from "./crash.ts";

const CRASH_MODULE = join(import.meta.dir, "crash.ts");

const CHILD = [
	`import { createHash } from "node:crypto";`,
	`import { mkdirSync } from "node:fs";`,
	`import { tmpdir } from "node:os";`,
	`import { join } from "node:path";`,
	`const mod = await import(${JSON.stringify(CRASH_MODULE)});`,
	`const mode = process.argv[2];`,
	`if (mode === "compile") {`,
	`  const hash = createHash("sha256").update(mod.crashSource).digest("hex").slice(0, 16);`,
	`  mkdirSync(join(tmpdir(), "crust-crash-" + hash + ".c"), { recursive: true });`,
	`} else {`,
	`  const u = mod.unit();`,
	`  u.symbols.crust_crash_disarm = function () { return mode === "refused" ? 11 : 0; };`,
	`  u.symbols.crust_crash_armed = function () { return mode === "refused" ? 1 : 0; };`,
	`  u.symbols.crust_crash_reason = function () { return ""; };`,
	`}`,
	`process.stdout.write(JSON.stringify(mod.disarmCrashHandlers()));`,
].join("\n");

const dirs: string[] = [];

afterEach(async () => {
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function run(mode: "zero" | "refused" | "compile"): Promise<CrashArm> {
	const root = await mkdtemp(join(tmpdir(), "crust-disarm-"));
	dirs.push(root);
	const script = join(root, "child.ts");
	await writeFile(script, CHILD, "utf8");
	const child = Bun.spawn({
		cmd: [process.execPath, script, mode],
		env: mode === "compile" ? { ...process.env, TMPDIR: root } : { ...process.env },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== 0) throw new Error(`child ${mode} exited ${code}: ${err}`);
	return JSON.parse(out.trim()) as CrashArm;
}

describe("darwin disarm adapter", () => {
	test("crust_crash_disarm's zero answers status 0 and the disarmed reason", async () => {
		expect(await run("zero")).toEqual({ armed: false, status: 0, reason: "disarmed" });
	});

	test("a refused signal answers its number, not a hardcoded success", async () => {
		expect(await run("refused")).toEqual({
			armed: true,
			status: 11,
			reason: "crust_crash_disarm answered 11",
		});
	});

	test("a compile refusal answers status -1 and names the failure", async () => {
		const answer = await run("compile");
		expect(answer.status).toBe(-1);
		expect(answer.armed).toBe(false);
		expect(answer.reason).toContain("the crash C unit did not compile:");
		expect(answer.reason).not.toBe("disarmed");
	});
});
