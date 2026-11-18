/**
 * Does this Bun accept `--aot`? The old probe in `build.ts` spawned `bun compile --help`,
 * which tests a *subcommand* that stable Bun does not have — it exits 1 ("Script not found
 * compile"), so the probe always answered "no" and the flag was never used. `bun build
 * --help` is no better: it does not list `--aot` even on 1.4.4, where the flag works.
 *
 * So the honest test is to try the exact command on a tiny scratch entry once and cache the
 * boolean. A Bun that refuses the flag exits non-zero and we fall back to plain
 * `bun build --compile`; a Bun that silently ignores it still produces a working (unoptimised)
 * binary, so nothing breaks. Measured on stable 1.4.4+38afee6c8: the flag is accepted but the
 * binary is byte-identical to the no-flag build, so the flag is free, not a size win there.
 */
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let cached: boolean | undefined;

/** One probe per process; the flag is a property of the Bun doing the building. */
export function supportsAot(): boolean {
	if (cached !== undefined) return cached;
	const dir = mkdtempSync(join(tmpdir(), "crust-aot-probe-"));
	const entry = join(dir, "entry.ts");
	const out = join(dir, "probe");
	try {
		writeFileSync(entry, "console.log('aot-probe')\n");
		const probe = Bun.spawnSync(
			["bun", "build", "--compile", "--aot", "--outfile", out, entry],
			{ stdout: "ignore", stderr: "ignore" },
		);
		cached =
			probe.exitCode === 0 &&
			[out, `${out}.exe`].some((p) => existsSync(p) && statSync(p).size > 0);
	} catch {
		cached = false;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	return cached;
}
