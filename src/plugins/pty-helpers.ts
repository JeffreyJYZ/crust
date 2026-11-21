/**
 * The small shared pieces of `crust:pty`: where a shell starts, and the two refusals every command
 * speaks. Split out of `pty.ts` so the plugin stays inside the 200-line cap without trimming the
 * lifecycle comments that record why a natural exit must close its handle.
 */

import { type PtyFailure, ptyFailure } from "./pty-types";

/** Where a terminal starts: the user's home on either platform, else the process's own directory. */
export function homeDir(): string {
	return process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
}

export function unknown(command: string, id: string): PtyFailure {
	return ptyFailure(
		"unknown-terminal",
		`pty.${command}: ${JSON.stringify(id)} is not a handle this run opened`,
	);
}

export function shut(command: string, id: string, error?: unknown): PtyFailure {
	const detail =
		error === undefined ? "" : `: ${error instanceof Error ? error.message : String(error)}`;
	return ptyFailure(
		"terminal-closed",
		`pty.${command}: terminal ${JSON.stringify(id)} is closed${detail}`,
	);
}
