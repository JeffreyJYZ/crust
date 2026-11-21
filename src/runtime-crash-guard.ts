/**
 * The crash guard: a second process, because the one thing a crashed process cannot do is finish writing. The parent arms the C handlers (`platform/darwin/crash.ts`); the handler writes a fixed record and exits; this process watches the parent's pid and, when the pid is gone, reads that record and records the crash.
 * The wait is liveness polling, not `waitpid`: a guard did not spawn the process it watches, so it cannot reap it and cannot read a wait status. The record is therefore the only trustworthy signal that an exit was a fault, and a clean exit leaves it empty, so nothing is written for one.
 * **The guard is the app's own executable, launched again in guard mode.** A compiled binary carries no readable copy of this file — `import.meta.path` is `/$bunfs/root/crust-app` there — so a script path is not an option. A source checkout runs this file directly (`bun src/runtime-crash-guard.ts --guard --pid <n> --root <dir>`); a compiled app passes `CRUST_CRASH_GUARD=<pid>` and `CRUST_CRASH_GUARD_ROOT=<dir>` in the environment, and `startApp` reads that marker before the single-instance lock, so the second launch is the guard rather than a rejected duplicate.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { CrustError } from "./bridge/errors";
import { trackChild } from "./child-reap.ts";
import { crashRecordPath } from "./platform/darwin/crash-record";
import { armGuardToken, disarmGuardToken, GUARD_TOKEN_VAR } from "./runtime-crash-guard-token.ts";
import {
	GUARD_PID_VAR,
	GUARD_ROOT_VAR,
	guardTarget,
	watchCrashTarget,
} from "./runtime-crash-guard-watch.ts";

export {
	GUARD_PID_VAR,
	GUARD_ROOT_VAR,
	guardTarget,
	runCrashGuardIfMarked,
	watchCrashTarget,
	type GuardTarget,
} from "./runtime-crash-guard-watch.ts";

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

/**
 * This file's path, or `undefined` when there is no readable copy of it: a compiled binary mounts
 * its sources at `/$bunfs` and nothing on disk answers to that path.
 */
function guardScriptPath(): string | undefined {
	const path = import.meta.path;
	if (!path.endsWith(".ts") || path.includes("/$bunfs/")) return undefined;
	return existsSync(path) ? path : undefined;
}

/**
 * The command and environment that launch a guard. In a checkout the script is the command; in a
 * compiled app the executable re-runs its own entry, and the marker is what makes that launch a
 * guard instead of a second copy of the app. The same pid and root travel in argv too, so `ps` names
 * what a guard is watching.
 */
export function guardLaunch(
	pid: number,
	root: string,
	token?: string,
): {
	cmd: string[];
	env: Record<string, string | undefined>;
} {
	const script = guardScriptPath();
	const cmd = [
		process.execPath,
		...(script === undefined ? [] : [script]),
		"--guard",
		"--pid",
		String(pid),
		"--root",
		root,
		...(token === undefined ? [] : ["--token", token]),
	];
	return {
		cmd,
		env: {
			...process.env,
			[GUARD_PID_VAR]: String(pid),
			[GUARD_ROOT_VAR]: root,
			...(token === undefined ? {} : { [GUARD_TOKEN_VAR]: token }),
		},
	};
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
	const token = armGuardToken(root);
	const { cmd, env } = guardLaunch(pid, root, token);
	let child: ReturnType<typeof Bun.spawn>;
	try {
		child = Bun.spawn({
			cmd,
			env,
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
		});
	} catch (error) {
		disarmGuardToken(root, token);
		throw error;
	}
	// A guard is a child of this process, so the quit reaper must be able to signal it.
	trackChild(child);
	if (pid === process.pid) {
		// A clean exit disarms the token; a crash handler's `_exit` cannot, which is the signal.
		process.once("exit", () => disarmGuardToken(root, token));
	}
	let stopped = false;
	return {
		pid: child.pid,
		running: () => !stopped && child.exitCode === null,
		stop: () => {
			if (stopped) return;
			stopped = true;
			disarmGuardToken(root, token);
			try {
				child.kill();
			} catch {
				// Already exited; there is nothing left to stop.
			}
		},
	};
}

if (import.meta.main) {
	const target = guardTarget(process.env, process.argv.slice(2));
	if (target === null) process.exit(2);
	void watchCrashTarget(target).then(() => process.exit(0));
}
