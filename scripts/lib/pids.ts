/**
 * Whether a pid a run captured earlier is still alive. Checked by pid, never by name: the child tree is captured while the run is up and the assertion happens after signalling, and `pgrep -f vite` would answer with every Vite on the machine.
 */
import { delay } from "./text.ts";

export function alivePid(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** The pids still running after `settleMs`, or an empty list once they are gone. */
export async function survivorsOfPids(pids: readonly number[], settleMs = 2000): Promise<number[]> {
	const deadline = performance.now() + settleMs;
	for (;;) {
		const left = pids.filter(alivePid);
		if (left.length === 0 || performance.now() >= deadline) return left;
		await delay(50);
	}
}
