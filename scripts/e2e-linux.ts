/**
 * The host-side driver for the Linux GTK proof: it asks the OrbStack machine `ubuntu-sandbox` what it
 * already has, installs only what is missing there, streams the platform layer in, then runs the
 * unit suite and the real-GTK proofs under `xvfb-run`. Nothing is installed on this Mac, and the
 * machine's own filesystem is the only thing written.
 *
 * The verdict is the exit code. A machine that cannot host GTK at all is reported as
 * `linux-gtk: UNAVAILABLE <reason>` with a non-zero exit, because a proof that cannot run is a
 * finding, never a pass — and a step that fails with the runtime present stays a plain FAIL, so a
 * defect in the layer is never excused as an unavailable machine.
 */
import { Verdict } from "./e2e-harness.ts";
import {
	ensureRuntime,
	exec,
	lastLine,
	MACHINE,
	REMOTE_DIR,
	runInSlice,
	sync,
} from "./linux/sandbox.ts";

/** The real-GTK proof the CI gate also runs; it owns the library, window and pump steps. */
const SMOKE = "scripts/linux-smoke.ts";

/** The one step that proof cannot take: `Platform.quit()` ending the process. */
const QUIT = "scripts/linux-gtk-quit.ts";

const UNIT = "bun test src/platform/linux";

/** A green suite is seconds; the deadline is a hang guard, not the normal path. */
const UNIT_TIMEOUT_S = 180;

/** Shim compile, GTK init, the steps — generous because the first WebKit process is slow. */
const SMOKE_TIMEOUT_S = 120;

/** Its own smoke: a `quit()` that does not exit is caught by this deadline. */
const QUIT_TIMEOUT_S = 60;

/** The verdict line `scripts/linux-smoke.ts` prints through the shared harness (two spaces). */
const SMOKE_PASS = /^linux:smoke: PASS\s+\d+\/\d+ assertions/m;

/** Its refusal, in its own words, before this driver re-labels it. */
const REFUSAL = /^unavailable: (.+)$/m;

/**
 * Reasons that mean the machine cannot host the proof, as opposed to the layer being wrong. Only
 * these become `UNAVAILABLE`; anything else is a FAIL with the runtime's own message.
 */
const MACHINE_REASON =
	/no display server|DISPLAY|not loadable|cannot load|missing symbol|needs Linux/i;

const UNIT_PASS = /(\d+) pass/;
const QUIT_MARKER = /^linux-gtk: quit — /m;
const QUIT_NOT_TAKEN = "NOT TAKEN";

function yes(flag: boolean): string {
	return flag ? "yes" : "no";
}

/** Print a child's transcript the way it arrived, so a log carries the proof verbatim. */
function transcript(title: string, result: { stdout: string; stderr: string }): void {
	console.log(`linux: ${title}`);
	if (result.stdout.trim().length > 0) console.log(result.stdout.trimEnd());
	if (result.stderr.trim().length > 0) console.log(result.stderr.trimEnd());
}

async function main(): Promise<number> {
	const verdict = new Verdict();

	// ---- 1. the machine answers -------------------------------------------
	const who = await exec("uname -m && . /etc/os-release && printf '%s ' \"$PRETTY_NAME\"");
	const reachable = who.code === 0 && who.stdout.includes("aarch64");
	verdict.check(
		"machine",
		reachable,
		reachable
			? `${MACHINE}: ${who.stdout.trim().split("\n").reverse().join(" ")}`
			: `orb run -m ${MACHINE} failed (${who.code}): ${lastLine(who.stderr) || lastLine(who.stdout)}`,
	);
	if (!reachable) return verdict.report("e2e:linux");

	// ---- 2. what it has, install only what is missing, what it has now ----
	const { after, installError } = await ensureRuntime();
	const complete = after.gtk && after.webkit;
	verdict.check(
		"gtk + webkit",
		complete,
		complete
			? "libgtk-3.so.0 and libwebkit2gtk-4.1.so.0 are loadable on the machine"
			: `libgtk-3.so.0=${yes(after.gtk)} libwebkit2gtk-4.1.so.0=${yes(after.webkit)}` +
					(installError ? ` — ${installError}` : ""),
	);
	verdict.check(
		"xvfb",
		after.xvfb,
		after.xvfb ? "xvfb-run is on PATH, so GTK has a headless display" : "xvfb-run is absent",
	);
	verdict.check(
		"bun",
		after.bun,
		after.bun ? "bun is installed inside the machine" : "bun absent",
	);

	// Without these there is nothing to prove, so the run stops with the honest refusal rather than
	// reporting proofs it never executed.
	if (!complete || !after.xvfb || !after.bun) {
		console.log("linux-gtk: UNAVAILABLE the machine cannot host the proof:");
		console.log(
			`  gtk=${yes(after.gtk)} webkit=${yes(after.webkit)} xvfb=${yes(after.xvfb)} bun=${yes(after.bun)}`,
		);
		if (installError) console.log(`  ${installError}`);
		verdict.report("e2e:linux");
		return 1;
	}

	// ---- 3. the slice arrives, then the suite runs on real Linux ----------
	const copy = await sync();
	const synced = verdict.check(
		"sync",
		copy.code === 0,
		copy.code === 0
			? `${REMOTE_DIR} holds src/ and scripts/`
			: `tar sync exited ${copy.code}: ${lastLine(copy.stderr)}`,
	);
	if (!synced) return verdict.report("e2e:linux");

	const unit = await runInSlice("", UNIT_TIMEOUT_S, UNIT);
	transcript("unit transcript (bun test src/platform/linux)", unit);
	// `bun test` writes its per-test lines and the summary to stderr, so both streams are read.
	const unitPass = (unit.stdout + unit.stderr).match(UNIT_PASS)?.[1];
	verdict.check(
		"unit",
		unit.code === 0 && unitPass !== undefined,
		unit.code === 0
			? `${unitPass} assertions passed on Linux arm64`
			: `bun test exited ${unit.code}: ${lastLine(unit.stderr) || lastLine(unit.stdout)}`,
	);

	// ---- 4. the real GTK path ---------------------------------------------
	const smoke = await runInSlice("xvfb-run -a", SMOKE_TIMEOUT_S, `bun run ${SMOKE}`);
	transcript(`smoke transcript (xvfb-run -a bun run ${SMOKE})`, smoke);
	const both = smoke.stdout + smoke.stderr;

	const refusal = both.match(REFUSAL)?.[1]?.trim();
	if (refusal !== undefined && MACHINE_REASON.test(refusal)) {
		verdict.check("smoke", false, `linux-gtk: UNAVAILABLE ${refusal}`);
		verdict.report("e2e:linux");
		// The exact refusal is the last line, so a log's tail says why in the proof's own words.
		console.log(`linux-gtk: UNAVAILABLE ${refusal}`);
		return 1;
	}

	const passed = smoke.stdout.match(SMOKE_PASS)?.[0];
	verdict.check(
		"smoke",
		smoke.code === 0 && passed !== undefined,
		smoke.code === 0
			? (passed ?? "the smoke exited 0 but printed no verdict line")
			: (refusal ?? `exited ${smoke.code}${smoke.code === 124 ? " (deadline)" : ""}: `) +
					(refusal === undefined
						? lastLine(smoke.stdout) || lastLine(smoke.stderr) || "no output"
						: ""),
	);

	// ---- 5. quit() ends the process ---------------------------------------
	const quit = await runInSlice("xvfb-run -a", QUIT_TIMEOUT_S, `bun run ${QUIT}`);
	transcript(`quit transcript (xvfb-run -a bun run ${QUIT})`, quit);
	const quitText = quit.stdout + quit.stderr;
	const quitRan = QUIT_MARKER.test(quitText) && !quitText.includes(QUIT_NOT_TAKEN);
	// Its own failure line, because stderr's last line is a dbus warning, not the reason.
	const quitReason = quitText.match(/^linux-gtk: quit: (?:FAIL — )?(.+)$/m)?.[1]?.trim();
	verdict.check(
		"quit",
		quit.code === 0 && quitRan,
		quit.code === 0
			? quitRan
				? "quit() ended the process with 0 from inside the platform"
				: "exit 0 without the marker, or quit() returned instead of exiting"
			: `exited ${quit.code}${quit.code === 124 ? " (deadline: quit() never ended the process)" : ""}: ` +
					`${quitReason ?? (lastLine(quitText) || "no output")}`,
	);

	return verdict.report("e2e:linux");
}

try {
	process.exit(await main());
} catch (error) {
	console.log(`e2e:linux: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
