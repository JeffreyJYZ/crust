/**
 * E2E for packaging: `crust dmg` makes a disk image and `crust sign` refuses honestly with no certificate — the path every user without a Developer ID takes, so the wording is the feature.
 * `diskutil image create from` writes an APFS container, so the detach device is parsed from `hdiutil attach`'s table, never guessed from `/Volumes/<name>`; the detach lives in a `finally` because a mounted volume shows on the user's desktop. Sign fails before reading the bundle, so the proof is that the hash and seal are unchanged. Phases in `package/phases/`.
 */

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Verdict } from "./e2e-harness.ts";
import { detachLeftover, isMounted, mountPointSeen } from "./package/hdiutil.ts";
import { buildPhase } from "./package/phases/build.ts";
import { dmgPhase } from "./package/phases/dmg.ts";
import { mountPhase } from "./package/phases/mount.ts";
import { signPhase } from "./package/phases/sign.ts";

async function main(): Promise<number> {
	if (process.platform !== "darwin") {
		console.log(
			`e2e-package: SKIP  this proof builds a macOS .dmg and needs hdiutil; ` +
				`running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	const verdict = new Verdict();
	const scratch = await mkdtemp(join(tmpdir(), "crust-e2e-package-"));
	try {
		await proof(verdict, scratch);
	} finally {
		// A throw must leave neither a volume on the user's desktop nor a temp tree.
		await detachLeftover().catch(() => undefined);
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
	}

	const mountedAt = mountPointSeen();
	const leftMounted = mountedAt !== null && (await isMounted(mountedAt));
	verdict.check(
		"mount clear",
		!leftMounted,
		leftMounted
			? `${mountedAt} is still mounted — detach it before this run is trusted`
			: `nothing from the image remains mounted${mountedAt ? ` (${mountedAt} was ejected)` : ""}`,
	);

	const scratchLeft = await stat(scratch)
		.then(() => true)
		.catch(() => false);
	verdict.check(
		"scratch gone",
		!scratchLeft,
		scratchLeft ? `${scratch} still exists` : `removed ${scratch}`,
	);

	return verdict.report("e2e-package");
}

async function proof(verdict: Verdict, scratch: string): Promise<void> {
	const built = await buildPhase(verdict, scratch);
	if (built === undefined) return;

	const printedVolume = await dmgPhase(verdict, scratch, built);
	await mountPhase(verdict, built, built.appName, printedVolume);
	await signPhase(verdict, scratch, built);
}

try {
	process.exit(await main());
} catch (error) {
	// A throw is still a verdict: the volume and the scratch tree are cleaned in
	// `main`'s finally before this line is reached.
	console.log(`e2e-package: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
