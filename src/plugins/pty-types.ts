/**
 * `crust:pty`'s shared vocabulary: what the host's section decides, the refusal every command
 * answers with, and the two events a page listens to.
 * Split from the plugin so the argument reader, the frame sink and the factory can name one
 * another without a cycle, and so a refusal shape is declared once rather than three times.
 */

/** What the host's `pty` section decides: the one program a terminal may run. */
export interface PtyOptions {
	/** Absolute path or PATH name of the program; absent is the user's login shell. */
	shell?: string;
}

export type PtyFailureCode =
	| "invalid-args"
	| "program-not-allowed"
	| "spawn-failed"
	| "unknown-terminal"
	| "terminal-closed";

/** The refusal shape every `crust:pty` command answers with; never a throw. */
export interface PtyFailure {
	ok: false;
	code: PtyFailureCode;
	message: string;
}

export function ptyFailure(code: PtyFailureCode, message: string): PtyFailure {
	return { ok: false, code, message };
}

/**
 * Whether a reader's answer is a refusal. Tested on `code`, not on `ok`: three readers answer a
 * success that carries `ok: true` too, so an `"ok" in value` test would hand a success back as a
 * refusal and skip the command entirely.
 */
export function isPtyFailure(value: object): value is PtyFailure {
	return "code" in value && typeof (value as PtyFailure).code === "string";
}

/**
 * One `pty-data` event. The bytes are base64, never a decoded string: a pty hands over whatever the
 * program wrote, so an ANSI sequence arriving in two reads must survive as two frames and stay
 * byte-exact rather than being decoded into replacement characters.
 */
export interface PtyData {
	id: string;
	chunk: string;
}

/** One `pty-exit` event: the child's own status, never `Bun.Terminal`'s lifecycle code. */
export interface PtyExit {
	id: string;
	exitCode: number | null;
	signal: string | null;
}
