/** Process gate for a recorder run. Reuses the harness snapshot and command runner. */

import { snapshot, type Conditions } from "../../../scripts/perf/conditions.ts";
import { runCommand } from "../../../scripts/e2e-harness.ts";

export { snapshot };
export type { Conditions };

export interface ProcessSnapshot {
	conditions: Conditions;
	/** Children of this recorder: the only processes this launch path could leave behind. */
	children: number[];
	/** New children seen after the run, by PID. */
	newChildren: number[];
}

export async function recorderSnapshot(): Promise<ProcessSnapshot> {
	const [conditions, children] = await Promise.all([snapshot(), childPids()]);
	return { conditions, children, newChildren: [] };
}

async function childPids(): Promise<number[]> {
	// One ps, then filter out the ps this snapshot just spawned. pgrep -P would list that helper
	// itself, so two snapshots report two different "new" PIDs with nothing having leaked.
	const { stdout } = await runCommand(["ps", "-axo", "pid=,ppid=,command="], process.cwd());
	const found: number[] = [];
	for (const line of stdout.split("\n")) {
		const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
		if (match === null) continue;
		const pid = Number(match[1]);
		const ppid = Number(match[2]);
		const argv = match[3] ?? "";
		// `snapshot()` spawns pgrep/ps/sysctl helpers under this same PPID; they are part of the
		// gate itself, not an app the recorder could have left running.
		if (ppid === process.pid && !/^\s*\(?(pgrep|ps|sysctl)\b/.test(argv)) found.push(pid);
	}
	return found;
}

/** Global bun count travels in metadata as contamination evidence; it is not the leak gate. */
export function processGate(before: ProcessSnapshot, after: ProcessSnapshot): ProcessSnapshot & { ok: boolean; text: string } {
	const newChildren = after.children.filter((pid) => !before.children.includes(pid));
	const ok = after.children.length <= before.children.length && newChildren.length === 0;
	after.newChildren = newChildren;
	return {
		...after,
		ok,
		text:
			`perf processes: children ${before.children.length} -> ${after.children.length} ` +
			`new=${newChildren.length} bun ${before.conditions.bunProcesses} -> ` +
			`${after.conditions.bunProcesses} (bun count is load evidence, not the gate) ${ok ? "PASS" : "FAIL"}`,
	};
}
