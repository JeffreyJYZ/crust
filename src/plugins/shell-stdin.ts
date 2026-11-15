/**
 * `crust:shell`'s stdin contract: what `write` accepts, and the typed refusal it answers when the process has no pipe to feed.
 * It sits apart from the allowlist rules because a page can only write to a process `spawn` already started.
 */

import { type ShellFailure, shellFailure } from "./shell-args";

/** `write`'s payload: which process, and the text to send down its pipe. */
export interface WriteArgs {
	id: string;
	data: string;
}

/** `{ id, data }` for `write`: a non-empty id plus the text to send. */
export function readWrite(args: unknown): WriteArgs | undefined {
	if (typeof args !== "object" || args === null) return undefined;
	const { id, data } = args as { id?: unknown; data?: unknown };
	if (typeof id !== "string" || id.length === 0 || typeof data !== "string") return undefined;
	return { id, data };
}

/** The refusal for a `write` with no open pipe to feed. */
export function noStdin(command: string, id: string, detail?: string): ShellFailure {
	const why = detail ?? 'it was spawned without stdin: "pipe"';
	const where = `shell.${command}: ${JSON.stringify(id)} has no writable stdin: ${why}`;
	return shellFailure("no-stdin", where);
}
