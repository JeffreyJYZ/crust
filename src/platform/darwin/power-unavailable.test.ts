/**
 * Finding 7's darwin half, pinned: a C unit that will not compile must never reach a page as a
 * fabricated battery reading or idle time. `powerUnit()` is module-level and not injectable, so the
 * refusal is forced in a child with an isolated `TMPDIR` whose source path is already occupied.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const POWER_MODULE = join(import.meta.dir, "power.ts");

const CHILD = [
	`import { createHash } from "node:crypto";`,
	`import { mkdirSync } from "node:fs";`,
	`import { tmpdir } from "node:os";`,
	`import { join } from "node:path";`,
	`const mod = await import(${JSON.stringify(POWER_MODULE)});`,
	`const hash = createHash("sha256").update(mod.powerSource).digest("hex").slice(0, 16);`,
	`mkdirSync(join(tmpdir(), "crust-power-" + hash + ".c"), { recursive: true });`,
	`const adapter = mod.darwinPowerAdapter();`,
	`process.stdout.write(JSON.stringify({ state: adapter.state(), idle: adapter.idleSeconds() }));`,
].join("\n");

describe("darwin power adapter with no compilable unit", () => {
	test("state and idleSeconds carry available:false and the same compile reason", async () => {
		const root = await mkdtemp(join(tmpdir(), "crust-power-unavailable-"));
		try {
			const script = join(root, "child.ts");
			await writeFile(script, CHILD, "utf8");
			const child = Bun.spawn({
				cmd: [process.execPath, script],
				env: { ...process.env, TMPDIR: root },
				stdout: "pipe",
				stderr: "pipe",
			});
			const [out, err, code] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			if (code !== 0) throw new Error(`child exited ${code}: ${err}`);
			const { state, idle } = JSON.parse(out.trim()) as {
				state: Record<string, unknown>;
				idle: Record<string, unknown>;
			};
			expect(state).toMatchObject({
				onAc: false,
				batteryPercent: null,
				lowPowerMode: false,
				available: false,
			});
			expect(state.reason).toContain("the power C unit did not compile:");
			expect(idle).toEqual({ available: false, reason: state.reason });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
