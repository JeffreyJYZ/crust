/**
 * Phase 0-1: a scratch copy of `examples/hello` and `crust build` — the command
 * `crust package` requires before any format can run, on the one host that can
 * produce a `.exe`. The copy keeps the checkout clean and gives `dist` a known start.
 */
import { cp, mkdir, readdir, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { runCommand, type Verdict } from "../../e2e-harness.ts";
import { lastLine, skip } from "../../lib/text.ts";
import {
	BINARY_NAME,
	CLI,
	EXAMPLE_DIR,
	type Built,
	type ExampleConfig,
	MIN_BINARY_BYTES,
	REPO_ROOT,
} from "../nsis-fixture.ts";

/** Assertions the build makes unknowable when it fails. */
export const AFTER_BUILD = [
	"package",
	"installer file",
	"installer pe",
	"installer size",
	"installer printed",
	"script",
	"script dir",
	"install",
	"install binary",
	"install pe",
	"install uninstaller",
] as const;

/** `undefined` means the run stops here: nothing was built to package. */
export async function buildPhase(verdict: Verdict, scratch: string): Promise<Built | undefined> {
	const configured = (await import(join(EXAMPLE_DIR, "crust.config.ts")))
		.default as ExampleConfig;
	const dist = join(scratch, "dist");
	const binary = join(dist, BINARY_NAME);
	// `crust package` puts every artefact inside `dist`, beside the binary, so the proof looks where
	// the command writes rather than one directory up in the project root.
	const installer = join(dist, `${configured.app.id}-${configured.app.version}-setup.exe`);
	const script = join(dist, `${configured.app.id}.nsi`);

	// ---- 0. the scratch project this proof packages ------------------------
	await mkdir(join(scratch, "node_modules"), { recursive: true });
	// A junction on Windows: it needs no developer mode and no elevation, and it is
	// what `projectCrustRoot` realpaths back to this checkout.
	await symlink(
		REPO_ROOT,
		join(scratch, "node_modules", "crust"),
		process.platform === "win32" ? "junction" : "dir",
	);
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
			: `incomplete copy in ${scratch}: ${inputs
					.map((ok, i) => `${["config", "main", "page"][i]} ${ok ? "ok" : "missing"}`)
					.join(", ")}`,
	);

	// ---- 1. `crust build`, the command `crust package` requires ------------
	const build = await runCommand([...CLI, "build", "--dir", scratch], REPO_ROOT);
	const built = build.code === 0;
	verdict.check(
		"build",
		built,
		build.code !== 0
			? `crust build exited ${build.code} — ${lastLine(build.stderr) || lastLine(build.stdout) || "no output"}`
			: "crust build exited 0",
	);

	if (!built) {
		skip(verdict, AFTER_BUILD, "not checked — crust build failed");
		console.log(build.stdout + build.stderr);
		return undefined;
	}

	// The `.exe` suffix is the whole portability question: Bun appends it on Windows
	// when the outfile carries no extension, so the file is what is asserted, not a name.
	const binaryStat = await stat(binary).catch(() => undefined);
	const present = binaryStat?.isFile() === true && binaryStat.size > MIN_BINARY_BYTES;
	const entries = (await readdir(dist).catch(() => [] as string[])).sort();
	verdict.check(
		"dist binary",
		present,
		present
			? `${binary} holds a ${binaryStat?.size ?? 0} byte ${BINARY_NAME}`
			: `${binary} ${binaryStat === undefined ? "is missing" : `is ${binaryStat.size} bytes`} — ` +
					`dist holds ${entries.join(", ") || "nothing"}`,
	);

	return { name: configured.app.name, dist, binary, installer, script };
}
