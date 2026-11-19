/**
 * The end of the run: the app closed its only window, exited 0 on its own, and nothing carrying the
 * binary's path is still alive.
 */
import { type Probe, survivorsOf, type Verdict } from "../../e2e-harness.ts";
import { seconds } from "../../lib/text.ts";
import { ALL_CLOSED } from "../expectations.ts";

export async function checkEnd(
	verdict: Verdict,
	run: Probe,
	exitLine: string,
	binary: string,
): Promise<void> {
	const closedLine = run.stdout.match(ALL_CLOSED)?.[0] ?? null;
	verdict.check(
		"all closed",
		closedLine !== null,
		closedLine !== null
			? `the backend printed ${JSON.stringify(closedLine.trim())}`
			: `window-all-closed never ran — ${exitLine}`,
	);

	const cleanExit = run.ended === "exit" && run.code === 0 && !run.timedOut;
	verdict.check(
		"exit 0",
		cleanExit,
		cleanExit
			? `the app exited 0 on its own after ${seconds(run.exitMs)}`
			: `${exitLine}${run.ended === "match" ? `, stopped on ${JSON.stringify(run.matched)}` : ""}`,
	);

	const survivors = await survivorsOf(binary);
	verdict.check(
		"no survivors",
		survivors.length === 0,
		survivors.length === 0
			? "no process matches the binary path"
			: `pid ${survivors.join(", ")} still running`,
	);
}
