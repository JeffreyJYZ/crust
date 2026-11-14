/**
 * The run itself: build through the CLI, check the bundle as a recipient would
 * find it, launch it from `/`, then hand the page's answers to the check groups
 * in the order those answers arrive.
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { clearSurvivors, probe, runCommand, type Verdict } from "../e2e-harness.ts";
import { lastLine, seconds } from "../lib/text.ts";
import { pageLines } from "./answers.ts";
import { checkCloseOfMain } from "./checks/close.ts";
import { checkCreates } from "./checks/creates.ts";
import { checkEnd } from "./checks/finish.ts";
import { checkNegatives } from "./checks/negatives.ts";
import { checkReopen } from "./checks/reopen.ts";
import { checkSpawns } from "./checks/spawn.ts";
import { checkWindows } from "./checks/windows.ts";
import { APP_TIMEOUT_MS, EXPECTED_TAGS, WAIT_FOR_EXIT, WINDOW_CHECKS } from "./expectations.ts";
import { APP_NAME } from "./fixture/config.ts";
import { CLI, REPO_ROOT, sandbox } from "./sandbox.ts";

export async function proof(verdict: Verdict, scratch: string): Promise<string | undefined> {
	const binary = await sandbox(scratch);
	const bundle = join(scratch, "dist", `${APP_NAME}.app`);

	// ---- 1. build through the CLI, as a user runs it ------------------------
	const build = await runCommand([CLI, "build", "--dir", scratch], REPO_ROOT);
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
		const why = "not checked — crust build failed";
		for (const name of ["bundle", "binary", "codesign", "page lines", ...WINDOW_CHECKS]) {
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
	const signature = await runCommand(["codesign", "-dv", "--verbose=4", bundle], REPO_ROOT);
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

	// The app ends itself, so an exit before the last answer is possible and is
	// sometimes the *cause* of it; both are reported by the two assertions below.
	// A hang is not: the probe's deadline kills it, and `timedOut` says so.
	const exitLine = run.timedOut
		? `still running after ${APP_TIMEOUT_MS / 1000} s`
		: `exited ${run.code ?? "null"}${run.signal ? ` (${String(run.signal)})` : ""} ` +
			`after ${seconds(run.exitMs)}`;

	// ---- 5. the page reported every step -----------------------------------
	// This is the guard the whole proof rests on: a window that closed early, or a
	// page that never loaded, leaves fewer lines and cannot pass on an exit alone.
	// The count is exact in both directions, so a document that loaded twice — a
	// child page reporting its create a second time — fails here too.
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
		for (const name of WINDOW_CHECKS) {
			verdict.check(name, false, why);
		}
		if (answers.length === 0) console.log(run.stdout + run.stderr);
		return binary;
	}

	checkWindows(verdict, byTag);
	checkNegatives(verdict, byTag);
	checkCreates(verdict, byTag);
	checkCloseOfMain(verdict, byTag);
	checkReopen(verdict, byTag);
	checkSpawns(verdict, byTag);
	await checkEnd(verdict, run, exitLine, binary);

	return binary;
}
