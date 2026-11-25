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

const ROOT = join(import.meta.dir, "../..");

/** A stub `osascript`: frontmost is a plain app, the AXFullScreen query answers nothing. */
async function runWithoutFullscreen(extra: string[] = []) {
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
			cmd: ["bun", "run", "scripts/probe-capture-fullscreen.ts", ...extra],
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
	for (const mode of ["bare", "ignoreOcclusion=true", "prime=true"])
		expect(out).toContain(`capture ${mode}:`);
	expect(child.exitCode).toBe(2);
	expect(out.trim().split("\n").length).toBeLessThanOrEqual(10);
});

test.skipIf(process.platform !== "darwin")(
	"--wait expires with the blocker printed and still refuses",
	async () => {
		const child = await runWithoutFullscreen(["--wait", "1"]);
		const out = child.stdout.toString();
		expect(out).toContain("waiting up to 1 s for another app to go fullscreen — press ⌃⌘F");
		expect(out).toMatch(
			/waited: 1\.\d s \(timed out — frontmost Test Terminal has no fullscreen window\)/,
		);
		expect(out).toContain("condition: NO");
		expect(out).not.toContain("condition: YES");
		expect(out).toContain("verdict: REFUSED");
		expect(child.exitCode).toBe(2);
	},
);
