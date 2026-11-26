/**
 * The refusal gate, with B stubbed: a taker that cannot go fullscreen must make A print exactly one
 * `unreachable` line and exit 2. No capture numbers, no pass, no invented state — a smoke run on an
 * ordinary desktop can never be mistaken for evidence that the condition was reached.
 */
import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { READY, TAKER } from "./protocol.ts";

const ROOT = join(import.meta.dir, "../..");
const REASON = "stub taker cannot go fullscreen";

async function runWithStub() {
	const dir = await mkdtemp(join(tmpdir(), "crust-offscreen-refusal-"));
	try {
		const stub = join(dir, "taker.ts");
		const body = [
			'import { writeFileSync } from "node:fs";',
			`writeFileSync(process.env[${JSON.stringify(READY)}] ?? "", JSON.stringify({`,
			`  status: "unreachable", reason: ${JSON.stringify(REASON)},`,
			"}));",
		].join("\n");
		await writeFile(stub, body);
		return Bun.spawnSync({
			cmd: ["bun", "run", "scripts/probe-capture-offscreen.ts"],
			cwd: ROOT,
			env: { ...process.env, [TAKER]: stub },
			stdout: "pipe",
			stderr: "pipe",
			timeout: 60_000,
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("stubbed taker cannot go fullscreen: unreachable, exit 2, never a pass", async () => {
	const child = await runWithStub();
	const out = child.stdout.toString();
	expect(out).toContain('"unreachable"');
	expect(out).toContain(REASON);
	expect(out).not.toContain('"bare"');
	expect(out).not.toContain('"ignoreOcclusion"');
	expect(out).not.toContain('"prime"');
	expect(out).not.toContain("PASS");
	expect(out.trim().split("\n")).toHaveLength(1);
	expect(child.exitCode).toBe(2);
});
