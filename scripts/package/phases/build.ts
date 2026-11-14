/**
 * Phase 0-1: a scratch copy of `examples/hello`, and `crust build` — the command
 * `dmg` and `sign` both require.
 */
import { cp, mkdir, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { runCommand, type Verdict } from "../../e2e-harness.ts";
import { lastLine, skip } from "../../lib/text.ts";
import {
	BINARY_NAME,
	CLI,
	EXAMPLE_DIR,
	type ExampleConfig,
	FALLBACK_DEPENDENCY,
	REPO_ROOT,
} from "../fixture.ts";

/** Everything the later phases address, once the example is configured. */
export interface Built {
	appName: string;
	dist: string;
	bundle: string;
	binary: string;
	image: string;
}

/** Assertions the build makes unknowable when it fails. */
export const AFTER_BUILD = [
	"done claim",
	"bundle",
	"dmg",
	"dmg file",
	"dmg size",
	"dmg path",
	"dmg bytes",
	"hdiutil verify",
	"attach",
	"image app",
	"image link",
	"volume",
	"detach",
	"sign",
	"sign message",
	"sign honest",
	"sign keeps",
	"sign seal",
] as const;

/** `undefined` means the run stops here: nothing was built to package. */
export async function buildPhase(verdict: Verdict, scratch: string): Promise<Built | undefined> {
	const configured = (await import(join(EXAMPLE_DIR, "crust.config.ts")))
		.default as ExampleConfig;
	const dist = join(scratch, "dist");
	const bundle = join(dist, `${configured.app.name}.app`);
	const binary = join(bundle, "Contents", "MacOS", BINARY_NAME);
	const image = join(dist, `${configured.app.name}-${configured.app.version}.dmg`);

	// ---- 0. the scratch project this proof packages ------------------------
	await mkdir(join(scratch, "node_modules"), { recursive: true });
	await symlink(FALLBACK_DEPENDENCY, join(scratch, "node_modules", "crust"), "dir");
	for (const name of ["crust.config.ts", "main.ts", "public"]) {
		await cp(join(EXAMPLE_DIR, name), join(scratch, name), { recursive: true });
	}
	const inputs = await Promise.all(
		["crust.config.ts", "main.ts", "public/index.html"].map((name) =>
			stat(join(scratch, name))
				.then((entry) => entry.isFile())
				.catch(() => false),
		),
	);
	verdict.check(
		"sandbox",
		inputs.every(Boolean),
		inputs.every(Boolean)
			? `copied examples/hello into ${scratch}`
			: `incomplete copy in ${scratch}: ${inputs.map((ok, i) => `${["config", "main", "page"][i]} ${ok ? "ok" : "missing"}`).join(", ")}`,
	);

	// ---- 1. `crust build`, the command `dmg` and `sign` both require -------
	const build = await runCommand([CLI, "build", "--dir", scratch], REPO_ROOT);
	const namedBundle = build.stdout.includes(bundle);
	const built = build.code === 0 && namedBundle;
	verdict.check(
		"build",
		built,
		build.code !== 0
			? `crust build exited ${build.code} — ${lastLine(build.stderr) || lastLine(build.stdout) || "no output"}`
			: namedBundle
				? "crust build exited 0 and named the bundle"
				: `crust build exited 0 but never printed ${bundle}`,
	);

	if (!built) {
		skip(verdict, AFTER_BUILD, "not checked — crust build failed");
		if (build.code !== 0) console.log(build.stdout + build.stderr);
		return undefined;
	}

	// `done — open it locally with: open X` is a claim about a file, so the file
	// it names is what is checked: a "done" line pointing at nothing is the exact
	// failure this catches.
	const done = build.stdout.match(/^done — open it locally with: open (.+)$/m);
	const donePath = done?.[1]?.trim() ?? "";
	const doneStat = donePath.length > 0 ? await stat(donePath).catch(() => undefined) : undefined;
	verdict.check(
		"done claim",
		doneStat?.isDirectory() === true,
		doneStat?.isDirectory() === true
			? `the done line names an existing bundle: ${donePath}`
			: done === null
				? "crust build printed no done line naming a bundle"
				: `the done line names ${donePath}, which is not a directory`,
	);

	const bundleStat = await stat(bundle).catch(() => undefined);
	const binaryStat = await stat(binary).catch(() => undefined);
	const packaged =
		bundleStat?.isDirectory() === true &&
		binaryStat?.isFile() === true &&
		(binaryStat.mode & 0o111) !== 0;
	verdict.check(
		"bundle",
		packaged,
		packaged
			? `${bundle} holds a ${binaryStat?.size ?? 0} byte executable ${BINARY_NAME}`
			: `${bundle} ${bundleStat?.isDirectory() === true ? `has no executable ${binary}` : "is missing"}`,
	);

	return { appName: configured.app.name, dist, bundle, binary, image };
}
