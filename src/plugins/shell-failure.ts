/**
 * The refusal shape every `crust:shell` command answers with, in one place so the argument reader, the path resolver and the environment reader answer it without importing each other.
 * A refusal is a value, never a throw: a page payload is whatever the bridge parsed, and the process must not exist by the time one is returned.
 */

export type ShellFailureCode =
	| "invalid-args"
	| "program-not-allowed"
	| "program-outside-root"
	| "cwd-not-allowed"
	| "env-not-allowed"
	| "spawn-failed"
	| "unknown-process"
	| "no-stdin";

/** The refusal shape every `crust:shell` command answers with. */
export interface ShellFailure {
	ok: false;
	code: ShellFailureCode;
	message: string;
}

export function shellFailure(code: ShellFailureCode, message: string): ShellFailure {
	return { ok: false, code, message };
}
