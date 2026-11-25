/**
 * The guard half: read the launch marker, watch the armed process and record a crash. Split from the
 * parent's spawn path so neither side crosses the 200-line cap. A pid alone is not an identity, so
 * the token file must still hold this launch's id while the pid is alive.
 */

import { execFileSync } from "node:child_process";
import { readCrashRecord, recordCrash } from "./runtime-crash-store";
import { GUARD_TOKEN_VAR, guardTokenHeld } from "./runtime-crash-guard-token.ts";

/** How often the guard asks whether the watched pid still exists. */
const POLL_MS = 100;

/** The pid a guard launch watches. Set by the parent, read by `startApp` before anything else. */
export const GUARD_PID_VAR = "CRUST_CRASH_GUARD";
/** The app data directory a guard launch writes into; the record, the log and `last-crash.json`. */
export const GUARD_ROOT_VAR = "CRUST_CRASH_GUARD_ROOT";
/** The armed process's start time; a pid alone can be reused before the next poll. */
export const GUARD_SINCE_VAR = "CRUST_CRASH_GUARD_SINCE";

/** What a guard launch was told to watch. */
export interface GuardTarget {
	pid: number;
	root: string;
	/** The parent's identity token; absent for a hand-run guard, which can only check the pid. */
	token?: string;
	/** Process start time captured when the token was armed, to detect pid reuse. */
	since?: string;
	/** Injectable in a test; defaults to reading the process start time. */
	identity?: (pid: number) => string | undefined;
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

/** The process's start time, or undefined when it is gone or the OS cannot report one. */
export function processStartTime(pid: number): string | undefined {
	try {
		const out = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return out.length === 0 ? undefined : out;
	} catch {
		return undefined;
	}
}

function flag(argv: readonly string[], name: string): string | undefined {
	const index = argv.indexOf(name);
	if (index < 0) return undefined;
	return argv[index + 1];
}

/**
 * The pid, root and token this launch was told to watch, or null for a normal launch. The environment
 * is what a compiled app can carry — its argv belongs to the app — and argv is the fallback a
 * checkout and a hand-run guard use.
 */
export function guardTarget(
	env: Record<string, string | undefined> = process.env,
	argv: readonly string[] = [],
): GuardTarget | null {
	const pid = Number(env[GUARD_PID_VAR] ?? flag(argv, "--pid"));
	const root = env[GUARD_ROOT_VAR] ?? flag(argv, "--root");
	if (!Number.isInteger(pid) || pid <= 0 || typeof root !== "string" || root.length === 0) {
		return null;
	}
	const token = env[GUARD_TOKEN_VAR] ?? flag(argv, "--token");
	const since = env[GUARD_SINCE_VAR] ?? flag(argv, "--since");
	return {
		pid,
		root,
		...(token === undefined ? {} : { token }),
		...(since === undefined ? {} : { since }),
	};
}

/** Watch the armed process, then record the crash if the record says one happened. */
export async function watchCrashTarget(target: GuardTarget): Promise<void> {
	const identity = target.identity ?? processStartTime;
	for (;;) {
		// A lost token is a clean exit: the parent disarmed it on its way out.
		if (!guardTokenHeld(target.root, target.token)) return;
		if (!alive(target.pid)) break;
		// The pid is live, but it may be a different process now. The token survives a fault, so it
		// cannot distinguish reuse; the start time can. Stop without recording the old crash.
		// An unreadable start time is not reuse: the process can exit between `alive` and `ps`, and
		// a loaded runner can make `ps` fail to fork. Only a *different* time proves a new process.
		if (target.since !== undefined) {
			const now = identity(target.pid);
			if (now !== undefined && now !== target.since) return;
		}
		// The identity probe may have outlived the process. Recheck liveness before sleeping, so a
		// fault whose child died during that probe is still recorded instead of left unwritten.
		if (!alive(target.pid)) break;
		await Bun.sleep(POLL_MS);
	}
	if (!guardTokenHeld(target.root, target.token)) return;
	// No record means a clean exit, and a clean exit is not a crash.
	const decoded = readCrashRecord(target.root);
	if (decoded) recordCrash(target.root, decoded);
}

/**
 * Run the guard in this process when this launch IS the guard; false for a normal launch. A compiled
 * app's entry calls `startApp`, so this is the one place that can tell the two apart, and it must run
 * before the single-instance lock: a guard is not a second copy of the app.
 */
export async function runCrashGuardIfMarked(
	env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
	const target = guardTarget(env);
	if (target === null) return false;
	await watchCrashTarget(target);
	return true;
}
