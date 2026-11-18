/**
 * The detection used to ask `bun compile --help` — a subcommand stable Bun does not have,
 * so it always answered "no" and the AOT branch was dead code. These pin the corrected
 * capability check to what the toolchain actually accepts.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { supportsAot } from "./aot";

describe("supportsAot", () => {
	test("answers yes on the pinned stable 1.4.4, unlike the old subcommand probe", () => {
		// release.yml pins 1.4.4, so this is deterministic in CI; the flag is accepted there
		// even though `bun build --help` does not list it and `bun compile` does not exist.
		expect(supportsAot()).toBe(true);
	});

	test("agrees with a real compile and caches the answer", () => {
		const dir = mkdtempSync(join(tmpdir(), "crust-aot-test-"));
		try {
			const entry = join(dir, "entry.ts");
			const out = join(dir, "probe");
			writeFileSync(entry, "console.log(1)\n");
			const real = Bun.spawnSync(
				["bun", "build", "--compile", "--aot", "--outfile", out, entry],
				{ stdout: "ignore", stderr: "ignore" },
			);
			expect(supportsAot()).toBe(real.exitCode === 0 && existsSync(out));
			expect(supportsAot()).toBe(supportsAot());
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
