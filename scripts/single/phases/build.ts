/**
 * Phase 2: `crust build app.tsx` — the bundle is assembled and ad-hoc signed,
 * then the binary inside it is launched with `/` as its working directory,
 * because that is the cwd a bundle gets from LaunchServices.
 */
import { stat } from "node:fs/promises";
import { probe, runCommand, survivorsOf, type Verdict } from "../../e2e-harness.ts";
import { lastLine, seconds, skip } from "../../lib/text.ts";
import { APP_FILE, APP_TIMEOUT_MS, CLI, INFO, type Paths, REPO_ROOT } from "../fixture.ts";

export async function buildPhase(verdict: Verdict, scratch: string, paths: Paths): Promise<void> {
	const build = await runCommand([CLI, "build", APP_FILE], scratch);
	const namedBundle = build.stdout.includes(paths.bundle);
	const built = build.code === 0 && namedBundle;
	verdict.check(
		"build",
		built,
		build.code !== 0
			? `crust build exited ${build.code} — ${lastLine(build.stderr) || lastLine(build.stdout) || "no output"}`
			: namedBundle
				? "crust build exited 0 and named the bundle"
				: `crust build exited 0 but never printed ${paths.bundle}`,
	);

	if (!built) {
		if (build.code !== 0) console.log(build.stdout + build.stderr);
		skip(
			verdict,
			["bundle", "binary", "codesign", "app info", "app stop", "app clean"],
			"not checked — crust build failed",
		);
		return;
	}

	const bundleStat = await stat(paths.bundle).catch(() => undefined);
	verdict.check(
		"bundle",
		bundleStat?.isDirectory() === true,
		bundleStat?.isDirectory() === true ? paths.bundle : `${paths.bundle} is not a directory`,
	);

	const binaryStat = await stat(paths.binary).catch(() => undefined);
	const executable = binaryStat?.isFile() === true && (binaryStat.mode & 0o111) !== 0;
	verdict.check(
		"binary",
		executable,
		binaryStat?.isFile() === true
			? `${paths.binary} (${binaryStat.size} bytes${executable ? "" : ", not executable"})`
			: `${paths.binary} is missing`,
	);

	const signature = await runCommand(["codesign", "-dv", "--verbose=4", paths.bundle], REPO_ROOT);
	const signatureText = `${signature.stderr}${signature.stdout}`;
	const adhoc = signature.code === 0 && /^Signature=adhoc$/m.test(signatureText);
	verdict.check(
		"codesign",
		adhoc,
		adhoc
			? "codesign -dv reports Signature=adhoc"
			: lastLine(signatureText) || "codesign -dv printed nothing",
	);

	// `/` is the cwd a bundle is launched with, and a single-file build has no
	// project directory to fall back to: the page must come from the binary's
	// own asset table. Anything written relative would throw here, exactly as
	// it would on a recipient's machine.
	const run = await probe({
		command: [paths.binary],
		cwd: "/",
		match: INFO,
		timeoutMs: APP_TIMEOUT_MS,
	});
	verdict.check(
		"app info",
		run.matched !== null,
		run.matched ??
			`no info answer within ${APP_TIMEOUT_MS / 1000} s with cwd / — ` +
				(lastLine(run.stdout) || lastLine(run.stderr) || "the binary printed nothing"),
	);

	const cleanExit = run.code === 0 && !run.timedOut;
	verdict.check(
		"app stop",
		cleanExit,
		cleanExit
			? `the built app exited 0 after ${seconds(run.exitMs)}`
			: `exit ${run.code ?? "null"}${run.signal ? ` (${String(run.signal)})` : ""}` +
					`${run.timedOut ? ` after the ${APP_TIMEOUT_MS / 1000} s deadline` : ""}`,
	);

	const remaining = await survivorsOf(paths.binary);
	verdict.check(
		"app clean",
		remaining.length === 0,
		remaining.length === 0
			? "no process matches the built binary path"
			: `pid ${remaining.join(", ")} still running`,
	);
}
