/**
 * The end-to-end proof for packaging: `crust dmg` makes a disk image, and
 * `crust sign` refuses honestly when there is no certificate.
 *
 * `e2e.ts` stops once the app answers from inside its bundle. The two commands a
 * user reaches for *after* that had no proof at all: `dmg` had produced one
 * 38.70 MiB image by hand, and `sign` had never been exercised — yet its refusal
 * is the path every user without a Developer ID takes, so the wording of that
 * refusal is the feature, not an error path to skip.
 *
 * Everything goes through the real CLI, in a scratch copy of `examples/hello`,
 * so the checkout's own `dist/` is never touched and the whole temp directory can
 * be deleted at the end. The bundle is never launched: an ad-hoc bundle runs on
 * this machine and is refused by Gatekeeper elsewhere, so `open` would prove
 * nothing and raise a dialog.
 *
 * Three facts this proof is built around:
 *
 *   - `diskutil image create from` writes an APFS container, so `hdiutil attach`
 *     prints several `/dev/disk*` lines and only one carries the mount point. The
 *     device to detach is parsed from that table, never guessed from
 *     `/Volumes/<name>`;
 *   - a failed assertion must not leave a volume mounted, because the user sees it
 *     on their desktop. Detach lives in a `finally`, and the run ends by proving
 *     nothing from the image is still attached;
 *   - `crust sign` fails before it reads the bundle, so the assertion that matters
 *     is that the refusal changed nothing: the binary's hash and the bundle's seal
 *     are identical afterwards.
 *
 * Usage:
 *   bun run scripts/e2e-package.ts    # or `bun run e2e:package` once package.json defines it
 *
 * The phases live in `package/phases/` — build, dmg, mount (with the detach in a
 * `finally`), sign — and `package/hdiutil.ts` owns the attach/eject state so a
 * throw can still clear the desktop.
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
