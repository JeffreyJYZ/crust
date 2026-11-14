/**
 * One windowed run of the compiled binary: stopped by the same SIGTERM its own
 * stop handler sees, then checked for the lines only a live page produces.
 */
import { probe, type Verdict } from "../e2e-harness.ts";
import { lastLine } from "../lib/text.ts";
import { DEV_TIMEOUT_MS } from "./fixture.ts";

/**
 * The probe waits for the *last* expected line, because stopping on the first
 * would cut the run before the rest arrived.
 */
export async function runOnce(
	verdict: Verdict,
	label: string,
	command: string[],
	cwd: string,
	expect: readonly RegExp[],
): Promise<void> {
	const last = expect.at(-1);
	if (last === undefined) throw new Error(`${label}: no line to wait for`);
	if (process.env.CRUST_E2E_TRACE === "1")
		console.log(`trace ${label}: cwd=${cwd} cmd=${JSON.stringify(command)}`);
	const result = await probe({
		command,
		cwd,
		match: last,
		timeoutMs: DEV_TIMEOUT_MS,
	});
	const text = result.stdout;
	const failed = expect.filter((pattern) => !pattern.test(text));
	verdict.check(
		label,
		failed.length === 0,
		failed.length === 0
			? `${result.matched} (${((result.matchedMs ?? 0) / 1000).toFixed(2)} s)`
			: `missing ${failed.map(String).join(", ")} — ` +
					(lastLine(result.stdout) || lastLine(result.stderr) || "nothing printed"),
	);
	let clean = result.code === 0;
	if (!clean) {
		// A run that had to be killed at the deadline proves nothing about the stop
		// path, and saying so beats reporting only the first failing line.
		const why = result.timedOut
			? `did not answer within ${DEV_TIMEOUT_MS / 1000} s`
			: `exit ${result.code ?? "null"}${result.signal ? ` (${String(result.signal)})` : ""}`;
		console.log(`note  ${label}: ${why}`);
		clean = false;
	}
	verdict.check(
		`${label} exit`,
		clean,
		clean ? "exit 0 after SIGTERM to the process group" : "see the note above",
	);
}
