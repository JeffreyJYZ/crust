/**
 * E2E for the AppImage: `crust package --format appimage` on Linux, proven against the artefact
 * rather than the line it prints — an ELF with the AppImage type-2 magic, an executable bit, a size
 * floor, and the AppDir `--appimage-extract` gives back (`AppRun`, the binary it names, the
 * `.desktop` entry and the icon). The `dmg` proof in `e2e-package.ts` is the shape this mirrors.
 *
 * A host that is not Linux cannot build one: `appimagetool` and the AppImage runtime are Linux
 * artefacts, so the run says so and exits non-zero instead of reporting a pass it never made.
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Verdict, runCommand } from "./e2e-harness.ts";
import { lastLine, skip } from "./lib/text.ts";
import { artifactPhase, parsePrinted } from "./package/appimage/artifact.ts";
import { listAppImages, stageProject } from "./package/appimage/fixture.ts";
import { CLI, REPO_ROOT } from "./package/fixture.ts";

/** Assertions a failed build or pack makes unknowable, so none of them can read as a pass. */
const AFTER = [
	"package",
	"appimage file",
	"appimage elf",
	"appimage size",
	"appimage mode",
	"printed bytes",
	"extract",
	"apprun",
	"desktop entry",
	"desktop link",
	"icon",
	"binary",
] as const;

async function proof(verdict: Verdict, scratch: string): Promise<void> {
	const staged = await stageProject(scratch);
	const inputs = await Promise.all(
		["crust.config.ts", "main.ts", "public/index.html", "icon.png"].map((name) =>
			stat(join(scratch, name))
				.then((entry) => entry.isFile())
				.catch(() => false),
		),
	);
	const stagedOk = verdict.check(
		"sandbox",
		inputs.every(Boolean),
		inputs.every(Boolean)
			? `copied examples/hello into ${scratch} with a ${staged.id} icon`
			: `incomplete copy in ${scratch}: ${inputs.map((ok, i) => `${["config", "main", "page", "icon"][i]} ${ok ? "ok" : "missing"}`).join(", ")}`,
	);
	if (!stagedOk) {
		skip(verdict, AFTER, "not checked — the scratch project is incomplete");
		return;
	}

	const build = await runCommand([CLI, "build", "--dir", scratch], REPO_ROOT);
	const built = build.code === 0;
	verdict.check(
		"build",
		built,
		built
			? "crust build exited 0 on Linux and assembled the bundle"
			: `crust build exited ${build.code} — ${lastLine(build.stderr) || lastLine(build.stdout) || "no output"}`,
	);
	if (!built) {
		skip(verdict, AFTER, "not checked — crust build failed");
		console.log(build.stdout + build.stderr);
		return;
	}

	const before = await listAppImages(staged.dist);
	const pack = await runCommand(
		[CLI, "package", "--dir", scratch, "--format", "appimage"],
		REPO_ROOT,
	);
	const packed = pack.code === 0;
	verdict.check(
		"package",
		packed,
		packed
			? "crust package --format appimage exited 0"
			: `crust package exited ${pack.code} — ${lastLine(pack.stderr) || lastLine(pack.stdout) || "no output"}`,
	);

	const after = await listAppImages(staged.dist);
	const created = after.filter((name) => !before.includes(name));
	const exists = (await stat(staged.image).catch(() => undefined))?.isFile() === true;
	verdict.check(
		"appimage file",
		packed && created.length === 1 && created[0] === basename(staged.image) && exists,
		!packed
			? "not checked — crust package failed"
			: created.length !== 1
				? `${created.length} new .AppImage file(s) in dist: ${created.join(", ") || "none"}`
				: exists
					? `${created[0]} is the one new image`
					: `${staged.image} was never written`,
	);

	await artifactPhase(verdict, staged, parsePrinted(pack.stdout), join(scratch, "extract"));
}

async function main(): Promise<number> {
	if (process.platform !== "linux") {
		console.log(
			`e2e-appimage: SKIP  this proof builds a Linux AppImage and needs appimagetool; ` +
				`running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	// `appimagetool` is itself an AppImage, and a runner without FUSE cannot mount one: the
	// runtime's own extract-and-run mode is the path that works in a container.
	process.env.APPIMAGE_EXTRACT_AND_RUN ??= "1";

	const verdict = new Verdict();
	const scratch = await mkdtemp(join(tmpdir(), "crust-e2e-appimage-"));
	try {
		await proof(verdict, scratch);
	} finally {
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
	}

	const left = await stat(scratch)
		.then(() => true)
		.catch(() => false);
	verdict.check("scratch gone", !left, left ? `${scratch} still exists` : `removed ${scratch}`);

	return verdict.report("e2e-appimage");
}

try {
	process.exit(await main());
} catch (error) {
	console.log(`e2e-appimage: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
