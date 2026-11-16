/**
 * E2E for the Windows installer: `crust build`, then `crust package --format nsis`,
 * and every claim checked against the artefact — a real PE installer, a size floor,
 * and the tree it installs when run with `/S` into a temp directory.
 * The silent install is the strongest evidence this format has: a script that only
 * compiles is not an installer. NSIS writes no icon here, so no icon is asserted —
 * that gap is named in the docs rather than faked with a file that proves nothing.
 * Phases in `package/phases/nsis-*.ts`.
 */

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Verdict } from "./e2e-harness.ts";
import { buildPhase } from "./package/phases/nsis-build.ts";
import { installPhase, installTarget } from "./package/phases/nsis-install.ts";

async function main(): Promise<number> {
	if (process.platform !== "win32") {
		console.log(
			`e2e-package-nsis: SKIP  this proof installs a Windows .exe and needs makensis; ` +
				`running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	const verdict = new Verdict();
	const scratch = await mkdtemp(join(tmpdir(), "crust-e2e-nsis-"));
	const target = installTarget();
	try {
		await proof(verdict, scratch);
	} finally {
		// A throw must leave neither the scratch tree nor an installed app behind.
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
		await rm(target, { recursive: true, force: true }).catch(() => undefined);
	}

	const scratchLeft = await stat(scratch)
		.then(() => true)
		.catch(() => false);
	verdict.check(
		"scratch gone",
		!scratchLeft,
		scratchLeft ? `${scratch} still exists` : `removed ${scratch}`,
	);

	const installLeft = await stat(target)
		.then(() => true)
		.catch(() => false);
	verdict.check(
		"install gone",
		!installLeft,
		installLeft ? `${target} still exists` : `removed ${target}`,
	);

	return verdict.report("e2e-package-nsis");
}

async function proof(verdict: Verdict, scratch: string): Promise<void> {
	const built = await buildPhase(verdict, scratch);
	if (built === undefined) return;
	// The install phase resolves the same target from the pid, so `main` clears the
	// path this call installs into.
	await installPhase(verdict, scratch, built);
}

try {
	process.exit(await main());
} catch (error) {
	console.log(
		`e2e-package-nsis: FAIL  ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exit(1);
}
