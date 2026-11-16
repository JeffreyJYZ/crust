/**
 * The crash guard: a second Bun process, because the one thing a crashed process cannot do is finish writing. The parent arms the C handlers (`platform/darwin/crash.ts`); the handler writes a fixed record and exits; this process watches the parent's pid and, when the pid is gone, reads that record and records the crash.
 * The wait is liveness polling, not `waitpid`: a guard did not spawn the process it watches, so it cannot reap it and cannot read a wait status. The record is therefore the only trustworthy signal that an exit was a fault, and a clean exit leaves it empty, so nothing is written for one.
 * `import.meta.main` is the guard's own entry: `bun src/runtime-crash-guard.ts --guard --pid <n> --root <dir>`.
 */

import { mkdirSync, rmSync } from "node:fs";
import { CrustError } from "./bridge/errors";
import { crashRecordPath } from "./platform/darwin/crash-record";
import { readCrashRecord, recordCrash } from "./runtime-crash-store";

/** How often the guard asks whether the watched pid still exists. */
const POLL_MS = 100;

export interface CrashGuardOptions {
	/** The app's data directory; the record, the log and `last-crash.json` live directly in it. */
	appDataDir: string;
	/** The process to watch; defaults to this one, which is what a runtime wants. */
	pid?: number;
}

export interface CrashGuard {
	/** The guard process's pid, so a caller can prove it is gone. */
	readonly pid: number;
	/** True until `stop()` or until the guard exits on its own. */
	running(): boolean;
	/** Kill the guard; a no-op once it has exited. */
	stop(): void;
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means it exists and belongs to someone else; only ESRCH means gone.
		return (error as { code?: string }).code === "EPERM";
	}
}

/**
 * The guard runs this file, so it needs a readable copy of it: a compiled binary has none, and
 * saying so beats spawning something that cannot work.
 */
function guardScriptPath(): string {
	const path = import.meta.path;
	if (!path.endsWith(".ts") || path.includes("/$bunfs/")) {
		throw new CrustError(
			"not-implemented",
			"startCrashGuard: the guard is a second Bun process running this file, and a compiled binary carries no readable copy of it. Run from a source checkout, or bundle the guard as its own entry.",
			{ requires: "a source checkout" },
		);
	}
	return path;
}

/**
 * Spawn the guard for `pid`. The record is deleted first, so a crash from an earlier run can never
 * be reported as this one's.
 */
export function startCrashGuard(options: CrashGuardOptions): CrashGuard {
	const root = options?.appDataDir;
	if (typeof root !== "string" || root.length === 0) {
		throw new CrustError(
			"bad-request",
			"startCrashGuard: appDataDir must be a non-empty string",
		);
	}
	const pid = options.pid ?? process.pid;
	if (!Number.isInteger(pid) || pid <= 0) {
		throw new CrustError("bad-request", "startCrashGuard: pid must be a positive integer");
	}
	mkdirSync(root, { recursive: true });
	rmSync(crashRecordPath(root), { force: true });
	const child = Bun.spawn({
		cmd: [process.execPath, guardScriptPath(), "--guard", "--pid", String(pid), "--root", root],
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
	});
	let stopped = false;
	return {
		pid: child.pid,
		running: () => !stopped && child.exitCode === null,
		stop: () => {
			if (stopped) return;
			stopped = true;
			try {
				child.kill();
			} catch {
				// Already exited; there is nothing left to stop.
			}
		},
	};
}

function flag(argv: readonly string[], name: string): string | undefined {
	const index = argv.indexOf(name);
	if (index < 0) return undefined;
	return argv[index + 1];
}

/** Watch the pid, then record the crash if the record says one happened. */
async function guardMain(argv: readonly string[]): Promise<void> {
	const pid = Number(flag(argv, "--pid"));
	const root = flag(argv, "--root");
	if (!Number.isInteger(pid) || pid <= 0 || root === undefined || root.length === 0) {
		process.exit(2);
	}
	while (alive(pid)) await Bun.sleep(POLL_MS);
	// No record means a clean exit, and a clean exit is not a crash.
	const decoded = readCrashRecord(root);
	if (decoded) recordCrash(root, decoded);
}

if (import.meta.main) {
	void guardMain(process.argv.slice(2)).then(() => process.exit(0));
}
