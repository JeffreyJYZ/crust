/**
 * The refusal path, proved with the harness-only composited-bit override: the probe window has a
 * composited view, so the predicate must print `condition: NO` and exit 2, never a pass. The stub
 * `osascript` keeps frontmost/fullscreen as plain context, not as the gate. On a non-darwin host the
 * probe refuses earlier and the same assertions still hold.
 */
import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

/** Spawn the probe with a forced composited window and a stub reporting no fullscreen app. */
async function runComposited(extra: string[] = []) {
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
			cmd: ["bun", "run", "scripts/probe-capture-fullscreen.ts", "--composited", ...extra],
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

test("composited window: condition NO, exit 2, never a pass", async () => {
	const child = await runComposited();
	const out = child.stdout.toString();
	expect(out).toContain("condition: NO");
	expect(out).not.toContain("condition: YES");
	expect(out).toContain("the probe window composited");
	expect(out).not.toContain("the probe window is on the active Space");
	expect(out).toContain("verdict: REFUSED");
	expect(out).not.toContain("verdict: PASS");
	for (const mode of ["bare", "ignoreOcclusion=true", "prime=true"])
		expect(out).toContain(`capture ${mode}:`);
	expect(child.exitCode).toBe(2);
	expect(out.trim().split("\n").length).toBeLessThanOrEqual(10);
});

test.skipIf(process.platform !== "darwin")(
	"--wait expires with compositing named as the blocker and still refuses",
	async () => {
		const child = await runComposited(["--wait", "1"]);
		const out = child.stdout.toString();
		expect(out).toContain("waiting up to 1 s for the view to stop compositing — press ⌃⌘F");
		expect(out).toMatch(
			/waited: 1\.\d s \(timed out — the probe window composited \(occlusionState=\d+, bit 2 set\)\)/,
		);
		expect(out).toContain("condition: NO");
		expect(out).not.toContain("condition: YES");
		expect(out).toContain("verdict: REFUSED");
		expect(child.exitCode).toBe(2);
	},
);
