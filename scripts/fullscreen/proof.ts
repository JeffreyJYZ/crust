/**
 * The run itself: build through the CLI, check the bundle as a recipient would find it, launch it
 * from `/`, then hand the page's answers to the assertions in the order they arrive.
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { clearSurvivors, probe, runCommand, type Verdict } from "../e2e-harness.ts";
import { lastLine, seconds } from "../lib/text.ts";
import { pageLines } from "../window/answers.ts";
import { checkEnd } from "./checks/finish.ts";
import { checkLaunch } from "./checks/launch.ts";
import { checkTransition } from "./checks/transition.ts";
import {
	APP_TIMEOUT_MS,
	BUILD_TIMEOUT_MS,
	CODESIGN_TIMEOUT_MS,
	EXPECTED_TAGS,
	FULLSCREEN_CHECKS,
	WAIT_FOR_EXIT,
} from "./expectations.ts";
import { APP_NAME } from "./fixture/config.ts";
import { CLI, REPO_ROOT, sandbox } from "./sandbox.ts";

export async function proof(verdict: Verdict, scratch: string): Promise<string | undefined> {
	const binary = await sandbox(scratch);
	const bundle = join(scratch, "dist", `${APP_NAME}.app`);

	// ---- 1. build through the CLI, as a user runs it ------------------------
	const build = await runCommand([CLI, "build", "--dir", scratch], REPO_ROOT, {
		timeoutMs: BUILD_TIMEOUT_MS,
	});
	const namedBundle = build.stdout.includes(bundle);
	const built = build.code === 0;
	const buildWhy =
		build.ended === "timeout"
			? lastLine(build.stderr) ||
				`crust build was killed at its ${BUILD_TIMEOUT_MS / 1000} s deadline`
			: `crust build exited ${build.code} — ${lastLine(build.stderr) || lastLine(build.stdout) || "no output"}`;
	const buildOk = verdict.check(
		"build",
		built && namedBundle,
		built
			? namedBundle
				? "crust build exited 0 and named the bundle"
				: `crust build exited 0 but never printed ${bundle}`
			: buildWhy,
	);
	if (!buildOk) {
		const why = "not checked — crust build failed";
		for (const name of ["bundle", "binary", "codesign", "page lines", ...FULLSCREEN_CHECKS]) {
			verdict.check(name, false, why);
		}
		if (!built) console.log(build.stdout + build.stderr);
		return undefined;
	}

	// ---- 2. the bundle is where a recipient would find it -------------------
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

	// ---- 3. ad-hoc signed, which is what `crust build` promises -------------
	const signature = await runCommand(["codesign", "-dv", "--verbose=4", bundle], REPO_ROOT, {
		timeoutMs: CODESIGN_TIMEOUT_MS,
	});
	const signatureText = `${signature.stderr}${signature.stdout}`;
	const adhoc = signature.code === 0 && /^Signature=adhoc$/m.test(signatureText);
	verdict.check(
		"codesign",
		adhoc,
		adhoc
			? "codesign -dv reports Signature=adhoc"
			: lastLine(signatureText) || "codesign -dv printed nothing",
	);

	// ---- 4. run it from `/`, as a launched bundle does ----------------------
	await clearSurvivors(binary);
	const run = await probe({
		command: [binary],
		cwd: "/",
		match: WAIT_FOR_EXIT,
		timeoutMs: APP_TIMEOUT_MS,
	});

	const answers = pageLines(run.stdout);
	const byTag = new Map(answers.map((entry) => [entry.tag, entry.answer]));

	const exitLine = run.timedOut
		? `still running after ${APP_TIMEOUT_MS / 1000} s`
		: `exited ${run.code ?? "null"}${run.signal ? ` (${String(run.signal)})` : ""} ` +
			`after ${seconds(run.exitMs)}`;

	// ---- 5. the page reported every step -----------------------------------
	// A window that closed early, or a page that never loaded, leaves fewer lines and cannot pass on
	// an exit alone. The count is exact in both directions, so a document that loaded twice fails here.
	const missing = EXPECTED_TAGS.filter((tag) => !byTag.has(tag));
	const extra = answers.filter(
		(entry) => !(EXPECTED_TAGS as readonly string[]).includes(entry.tag),
	);
	const repeated = answers.length - byTag.size;
	const complete = missing.length === 0 && extra.length === 0 && repeated === 0;
	const countOk = verdict.check(
		"page lines",
		complete,
		complete
			? `${answers.length} answers, one per step, from ${EXPECTED_TAGS.length} steps`
			: `${answers.length} page answers — ` +
					`${missing.length > 0 ? `missing ${missing.join(", ")}` : "none missing"}` +
					`${extra.length > 0 ? `, unexpected ${extra.map((entry) => entry.tag).join(", ")}` : ""}` +
					`${repeated > 0 ? `, ${repeated} reported twice` : ""}` +
					` — ${exitLine}`,
	);
	if (!countOk) {
		const why = `not checked — the page did not report every step (${exitLine})`;
		for (const name of FULLSCREEN_CHECKS) verdict.check(name, false, why);
		if (answers.length === 0) console.log(run.stdout + run.stderr);
		return binary;
	}

	checkLaunch(verdict, byTag);
	checkTransition(verdict, byTag);
	await checkEnd(verdict, run, exitLine, binary);

	return binary;
}
