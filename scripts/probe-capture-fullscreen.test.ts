/**
 * The refusal path, proved with an `osascript` stub that reports a frontmost app and NO fullscreen
 * window. The same script, same exit code path: a normal desktop must print `condition: NO` and
 * exit 2, so a smoke run on an ordinary machine can never be mistaken for evidence. On a non-darwin
 * host the probe refuses earlier and the same three assertions still hold.
 */
import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

/** A stub `osascript`: frontmost is a plain app, the AXFullScreen query answers nothing. */
async function runWithoutFullscreen() {
	const dir = await mkdtemp(join(tmpdir(), "crust-fullscreen-refusal-"));
	try {
		const script = join(dir, "osascript");
		await writeFile(
			script,
			'#!/bin/sh\ncase "$*" in\n  *AXFullScreen*) : ;;\n  *) printf "%s\\n" "Test Terminal" ;;\nesac\n',
			{ mode: 0o755 },
		);
		await chmod(script, 0o755);
		return Bun.spawnSync({
			cmd: ["bun", "run", "scripts/probe-capture-fullscreen.ts"],
			cwd: ROOT,
			env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
			stdout: "pipe",
			stderr: "pipe",
			timeout: 60_000,
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("no fullscreen app: condition NO, exit 2, never a pass", async () => {
	const child = await runWithoutFullscreen();
	const out = child.stdout.toString();
	expect(out).toContain("condition: NO");
	expect(out).not.toContain("condition: YES");
	expect(out).toContain("verdict: REFUSED");
	expect(out).not.toContain("verdict: PASS");
	expect(child.exitCode).toBe(2);
	expect(out.trim().split("\n").length).toBeLessThanOrEqual(10);
});
