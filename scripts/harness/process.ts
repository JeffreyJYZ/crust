/**
 * The two facts a run has to be sure of about processes it did not keep: that
 * nothing it started is still alive, and that nothing an *earlier* run started
 * is either.
 */
import { runCommand } from "./verdict.ts";

/** PIDs whose argv matches `pattern`, via `pgrep -f`. Never throws. */
async function matchingPids(pattern: string): Promise<number[]> {
	// pgrep exits 1 when nothing matches; that is an empty answer, not an error.
	const { stdout } = await runCommand(["pgrep", "-f", pattern], process.cwd());
	return stdout
		.split("\n")
		.map((line) => Number.parseInt(line.trim(), 10))
		.filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

/**
 * Kill anything matching `pattern` left over from an earlier run, and say so.
 *
 * The alternative is a harness that fails forever after one abort, because the
 * survivor assertion is then true regardless of this run. A leftover is ours:
 * the pattern is a path this script just built.
 */
export async function clearSurvivors(pattern: string): Promise<void> {
	for (const pid of await matchingPids(pattern)) {
		try {
			process.kill(pid, "SIGKILL");
			console.log(`note  cleared leftover pid ${pid} matching ${pattern}`);
		} catch {
			// Exited between `pgrep` and `kill`; nothing to clear.
		}
	}
}

/**
 * Wait for every matching process to be gone, then return what is left.
 *
 * A child that just received `SIGTERM` needs a moment to leave the process
 * table, so an immediate `pgrep` proves nothing. Bounded, because a survivor
 * that never dies must be reported rather than waited on.
 */
export async function survivorsOf(pattern: string, settleMs = 2000): Promise<number[]> {
	const deadline = performance.now() + settleMs;
	for (;;) {
		const pids = await matchingPids(pattern);
		if (pids.length === 0 || performance.now() >= deadline) return pids;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}
