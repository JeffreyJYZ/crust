/**
 * Phase 2: `crust dmg` makes a real image, and every claim it prints about that
 * image is checked against the file rather than trusted as text.
 */
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { formatBytes } from "../../../src/packaging/build.ts";
import { runCommand, type Verdict } from "../../e2e-harness.ts";
import { lastLine } from "../../lib/text.ts";
import { CLI, listDmgs, MIN_DMG_BYTES, REPO_ROOT } from "../fixture.ts";
import type { Built } from "./build.ts";

export async function dmgPhase(verdict: Verdict, scratch: string, built: Built): Promise<string> {
	const dmgsBefore = await listDmgs(built.dist);
	const dmgRun = await runCommand([CLI, "dmg", "--dir", scratch], REPO_ROOT);
	const dmgOk = dmgRun.code === 0;
	verdict.check(
		"dmg",
		dmgOk,
		dmgOk
			? "crust dmg exited 0"
			: `crust dmg exited ${dmgRun.code} — ${lastLine(dmgRun.stderr) || lastLine(dmgRun.stdout) || "no output"}`,
	);

	const dmgsAfter = await listDmgs(built.dist);
	const created = dmgsAfter.filter((name) => !dmgsBefore.includes(name));
	const dmgStat = await stat(built.image).catch(() => undefined);
	const imageExists = dmgStat?.isFile() === true;
	const imageBytes = dmgStat?.size ?? 0;

	verdict.check(
		"dmg file",
		dmgOk && created.length === 1 && created[0] === basename(built.image) && imageExists,
		dmgOk
			? !imageExists
				? `${built.image} was never written (dist holds ${dmgsAfter.join(", ") || "no .dmg"})`
				: created.length !== 1
					? `${created.length} new .dmg file(s) in dist: ${created.join(", ") || "none"}`
					: `${created[0]} is the one new image`
			: "not checked — crust dmg failed",
	);

	verdict.check(
		"dmg size",
		imageExists && imageBytes > MIN_DMG_BYTES,
		imageExists
			? `${formatBytes(imageBytes)} (${imageBytes} bytes), ${MIN_DMG_BYTES / 1024 / 1024} MiB floor`
			: "no image to measure",
	);

	// The commands print paths, a size and a volume name; each is checked against
	// the artefact rather than trusted as text.
	const imageLine = dmgRun.stdout.match(/^\s{2}image\s+(.+?) \(([^()]+)\)$/m);
	const bundleLine = dmgRun.stdout.match(/^\s{2}bundle\s+(.+)$/m);
	const volumeLine = dmgRun.stdout.match(/^\s{2}volume\s+(.+)$/m);
	const printedImage = imageLine?.[1]?.trim() ?? "";
	const printedBundle = bundleLine?.[1]?.trim() ?? "";
	const printedVolume = volumeLine?.[1]?.trim() ?? "";

	verdict.check(
		"dmg path",
		printedImage === built.image && printedBundle === built.bundle,
		printedImage === built.image && printedBundle === built.bundle
			? `printed image and bundle paths are the files on disk`
			: `printed image ${printedImage || "(none)"} / bundle ${printedBundle || "(none)"} — ` +
					`expected ${built.image} / ${built.bundle}`,
	);

	const printedBytes = imageLine?.[2]?.trim() ?? "";
	const actualBytes = imageExists ? formatBytes(imageBytes) : "no image";
	verdict.check(
		"dmg bytes",
		printedBytes === actualBytes,
		printedBytes === actualBytes
			? `printed size matches the file: ${printedBytes}`
			: `printed ${printedBytes || "(none)"} but the file is ${actualBytes}`,
	);

	const verify = await runCommand(["hdiutil", "verify", built.image], REPO_ROOT);
	verdict.check(
		"hdiutil verify",
		verify.code === 0,
		verify.code === 0
			? "hdiutil verify reports a valid checksum"
			: `hdiutil verify exited ${verify.code} — ${lastLine(verify.stderr) || lastLine(verify.stdout)}`,
	);

	// The volume name `crust dmg` printed is compared against the mounted one in
	// the mounting phase, which is the only place it can be observed.
	return printedVolume;
}
