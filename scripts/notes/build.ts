/**
 * Building `examples/notes` through the CLI, and the bundle-level facts that
 * follow: the embedded assets, the directory, the executable and the seal.
 */
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runCommand, type Verdict } from "../e2e-harness.ts";
import { lastLine } from "../lib/text.ts";

export const REPO_ROOT = resolve(import.meta.dir, "../..");
export const PROJECT_DIR = join(REPO_ROOT, "examples/notes");
export const CLI = join(REPO_ROOT, "src/cli/index.ts");

/** `app.name` in examples/notes/crust.config.ts, plus the binary name build.ts pins. */
export const BUNDLE = join(PROJECT_DIR, "dist", "Notes.app");
export const BINARY = join(BUNDLE, "Contents", "MacOS", "crust-app");

/**
 * What `public/` holds — embedded whole. It was three files (index.html, app.js,
 * style.css) until the 200-line split moved the script and the stylesheet into
 * modules, so this is read from the directory rather than remembered: a count in
 * a constant silently rots the moment an example gains a file.
 */
const ASSET_COUNT = (await Array.fromAsync(new Bun.Glob("*").scan(join(PROJECT_DIR, "public")))).length;

/** `undefined` means the build failed: every later assertion is unknowable. */
export async function buildPhase(verdict: Verdict): Promise<boolean> {
	// ---- 1. build through the CLI, as a user runs it ------------------------
	const build = await runCommand([CLI, "build", "--dir", "examples/notes"], REPO_ROOT);
	const namedBundle = build.stdout.includes(BUNDLE);
	const built = build.code === 0;
	const buildOk = verdict.check(
		"build",
		built && namedBundle,
		built
			? namedBundle
				? "crust build exited 0 and named the bundle"
				: `crust build exited 0 but never printed ${BUNDLE}`
			: `crust build exited ${build.code} — ${lastLine(build.stderr) || lastLine(build.stdout) || "no output"}`,
	);
	if (!buildOk) {
		const why = "not checked — crust build failed";
		for (const name of [
			"assets",
			"bundle",
			"binary",
			"codesign",
			"listed",
			"exit 0",
			"no survivors",
		]) {
			verdict.check(name, false, why);
		}
		if (!built) console.log(build.stdout + build.stderr);
		return false;
	}

	// ---- 2. the page is embedded, not read from a project directory ---------
	const assetsLine = new RegExp(`assets\\s+${ASSET_COUNT} files from public/`).test(build.stdout);
	verdict.check(
		"assets",
		assetsLine,
		assetsLine
			? `crust build embedded ${ASSET_COUNT} files from public/`
			: `crust build never reported ${ASSET_COUNT} assets — ${lastLine(build.stdout)}`,
	);

	// ---- 3. the bundle is where a recipient would find it -------------------
	const bundleStat = await stat(BUNDLE).catch(() => undefined);
	verdict.check(
		"bundle",
		bundleStat?.isDirectory() === true,
		bundleStat?.isDirectory() === true ? BUNDLE : `${BUNDLE} is not a directory`,
	);

	const binaryStat = await stat(BINARY).catch(() => undefined);
	const executable = binaryStat?.isFile() === true && (binaryStat.mode & 0o111) !== 0;
	verdict.check(
		"binary",
		executable,
		binaryStat?.isFile() === true
			? `${BINARY} (${binaryStat.size} bytes${executable ? "" : ", not executable"})`
			: `${BINARY} is missing`,
	);

	// ---- 4. ad-hoc signed, which is what `crust build` promises -------------
	const signature = await runCommand(["codesign", "-dv", "--verbose=4", BUNDLE], REPO_ROOT);
	const signatureText = `${signature.stderr}${signature.stdout}`;
	const adhoc = signature.code === 0 && /^Signature=adhoc$/m.test(signatureText);
	verdict.check(
		"codesign",
		adhoc,
		adhoc
			? "codesign -dv reports Signature=adhoc"
			: lastLine(signatureText) || "codesign -dv printed nothing",
	);

	return true;
}
