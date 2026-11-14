/**
 * Phases 1-3: the copy installs with this checkout as the framework, `crust
 * build` names the bundle, and the bundle holds an executable.
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { runCommand, type Verdict } from "../../e2e-harness.ts";
import { lastLine, skip } from "../../lib/text.ts";
import { AFTER_BUILD, AFTER_RUN } from "../report.ts";
import { APP_NAME, BINARY_NAME, CLI, REPO_ROOT, sandbox } from "../fixture.ts";

export interface Built {
	bundle: string;
	binary: string;
	/** False when the bundle holds no executable: the run assertions are skipped. */
	runnable: boolean;
}

/** `undefined` means the run stops here: nothing was built to launch. */
export async function buildPhase(verdict: Verdict, scratch: string): Promise<Built | undefined> {
	await sandbox(scratch);
	const bundle = join(scratch, "dist", `${APP_NAME}.app`);
	const binary = join(bundle, "Contents", "MacOS", BINARY_NAME);

	// ---- 1. the copy installs, with this checkout as the framework ---------
	// `bun install` is what a user runs before a build, and the example's own
	// `beforeBuildCommand` is `./node_modules/.bin/vite build`, so a missing
	// install fails the build rather than this line.
	const install = await runCommand(["bun", "install"], scratch);
	const linked = await stat(join(scratch, "node_modules", "crust"))
		.then(() => true)
		.catch(() => false);
	const viteBin = await stat(join(scratch, "node_modules", ".bin", "vite"))
		.then(() => true)
		.catch(() => false);
	const installed = install.code === 0 && linked && viteBin;
	verdict.check(
		"install",
		installed,
		install.code !== 0
			? `bun install exited ${install.code} — ${lastLine(install.stderr) || lastLine(install.stdout)}`
			: !linked
				? "node_modules/crust is missing — the example cannot import the framework"
				: !viteBin
					? "node_modules/.bin/vite is missing — the example's build command would fail"
					: "bun install linked the checkout and installed the front end",
	);
	if (!installed) {
		skip(verdict, ["build", ...AFTER_BUILD], "not checked — the example copy did not install");
		return undefined;
	}

	// ---- 2. build through the CLI, as the example's README does ------------
	const build = await runCommand(
		[CLI, "build", "--dir", scratch, "--entry", "desktop/main.ts"],
		REPO_ROOT,
	);
	const namedBundle = build.stdout.includes(bundle);
	const built = build.code === 0;
	const buildOk = verdict.check(
		"build",
		built && namedBundle,
		built
			? namedBundle
				? "crust build exited 0 and named the bundle"
				: `crust build exited 0 but never printed ${bundle}`
			: `crust build exited ${build.code} — ${lastLine(build.stderr) || lastLine(build.stdout) || "no output"}`,
	);
	if (!buildOk) {
		skip(verdict, AFTER_BUILD, "not checked — crust build failed");
		if (!built) console.log(build.stdout + build.stderr);
		return undefined;
	}

	// ---- 3. the bundle is where a recipient would find it -------------------
	const bundleStat = await stat(bundle).catch(() => undefined);
	verdict.check(
		"bundle",
		bundleStat?.isDirectory() === true,
		bundleStat?.isDirectory() === true ? bundle : `${bundle} is not a directory`,
	);

	const binaryStat = await stat(binary).catch(() => undefined);
	const executable = binaryStat?.isFile() === true && (binaryStat.mode & 0o111) !== 0;
	verdict.check(
		"binary",
		executable,
		binaryStat?.isFile() === true
			? `${binary} (${binaryStat.size} bytes${executable ? "" : ", not executable"})`
			: `${binary} is missing`,
	);
	if (!executable) {
		skip(verdict, AFTER_RUN, "not checked — the bundle holds no executable");
		return { bundle, binary, runnable: false };
	}

	return { bundle, binary, runnable: true };
}
