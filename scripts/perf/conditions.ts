/**
 * The conditions a number was taken under. A perf run beside three sibling
 * builds measures the siblings as much as the app, so load and bun count are
 * recorded at both ends of every run and travel with the JSON sample.
 */
import { runCommand } from "../e2e-harness.ts";

export const LOAD_LIMIT = 2.0;

export interface Conditions {
	at: string;
	/** The three numbers from `sysctl -n vm.loadavg`, in order. */
	load: { one: number; five: number; fifteen: number };
	/** Global `bun` process count; siblings are visible here but are not a leak gate. */
	bunProcesses: number;
	/** PIDs whose argv points at this probe app or this harness. */
	probePids: number[];
}

export interface RunConditions {
	start: Conditions;
	end: Conditions;
	/** True when either end's one-minute load is above LOAD_LIMIT. */
	contaminated: boolean;
}

const numbers = (text: string): number[] =>
	(text.match(/\d+(?:\.\d+)?/g) ?? []).map((value) => Number.parseFloat(value));

/** PIDs matching the probe, read with argv so a sibling's `bun` is never claimed. */
async function probePids(): Promise<number[]> {
	const { stdout } = await runCommand(
		["pgrep", "-f", "perf-probe|scripts/perf/measure\\.ts"],
		process.cwd(),
	);
	const candidates = stdout
		.split("\n")
		.map((line) => Number.parseInt(line.trim(), 10))
		.filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
	const found: number[] = [];
	for (const pid of candidates) {
		const { stdout: argv } = await runCommand(
			["ps", "-o", "command=", "-p", String(pid)],
			process.cwd(),
		);
		if (/perf-probe|scripts\/perf\/measure\.ts/.test(argv)) found.push(pid);
	}
	return found;
}

export async function snapshot(): Promise<Conditions> {
	const [loadText, bunText, pids] = await Promise.all([
		runCommand(["sysctl", "-n", "vm.loadavg"], process.cwd()),
		// macOS pgrep has no `-c`: count its numeric lines instead.
		runCommand(["pgrep", "-x", "bun"], process.cwd()),
		probePids(),
	]);
	const [one = 0, five = 0, fifteen = 0] = numbers(loadText.stdout);
	const count = bunText.stdout
		.split("\n")
		.map((line) => Number.parseInt(line.trim(), 10))
		.filter((pid) => Number.isInteger(pid) && pid > 0).length;
	return {
		at: new Date().toISOString(),
		load: { one, five, fifteen },
		bunProcesses: count,
		probePids: pids,
	};
}

export function runConditions(start: Conditions, end: Conditions): RunConditions {
	return {
		start,
		end,
		contaminated: start.load.one > LOAD_LIMIT || end.load.one > LOAD_LIMIT,
	};
}
