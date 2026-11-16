/**
 * `crust:shell`'s argument reading: a page payload is whatever the bridge parsed, so every reader answers a typed failure instead of throwing, and a program, a `cwd` or an `env` is refused before any process exists.
 * The rules themselves live in `shell-resolve.ts` (paths) and `shell-env.ts` (environment); this file only reads the payload and hands each part to them.
 */

import { readEnv } from "./shell-env";
import { type ShellFailure, shellFailure } from "./shell-failure";
import { type ShellRules, resolveCwd, resolveProgram } from "./shell-resolve";

export interface SpawnArgs {
	program: string;
	args?: string[];
	cwd?: string;
	/** Refused unless the host opted in, and the loader and shell names are refused even then. */
	env?: Record<string, string>;
	/** `"pipe"` gives `write` something to feed; the default `"ignore"` reads as immediate EOF. */
	stdin?: "pipe" | "ignore";
}

export function unknownProcess(command: string, id: unknown): ShellFailure {
	return shellFailure(
		"unknown-process",
		`shell.${command}: no process with id ${JSON.stringify(id)}`,
	);
}

/** `{ id }`, the only argument the commands after `spawn` take. */
export function readId(args: unknown): string | undefined {
	if (typeof args !== "object" || args === null) return undefined;
	const value = (args as { id?: unknown }).id;
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The id a command needs, or the refusal to answer with instead of throwing. */
export function requireId(args: unknown, command: string): { ok: true; id: string } | ShellFailure {
	const id = readId(args);
	if (id !== undefined) return { ok: true, id };
	return shellFailure("invalid-args", `shell.${command} needs { id } with a non-empty string`);
}

/** What `spawn` hands `Bun.spawn`, already checked. */
export interface SpawnPlan {
	ok: true;
	/** `cmd[0]` is the real path that was checked, so nothing re-resolves a name at spawn time. */
	cmd: string[];
	cwd: string;
	env: Record<string, string>;
	/** Whether stdin is a pipe a page may write to. */
	pipe: boolean;
}

function readArgs(value: unknown): { ok: true; argv: string[] } | ShellFailure {
	const argv: string[] = [];
	if (value === undefined) return { ok: true, argv };
	if (!Array.isArray(value)) {
		return shellFailure("invalid-args", 'shell.spawn: "args" must be an array of strings');
	}
	for (const item of value) {
		if (typeof item !== "string" || item.includes("\0")) {
			return shellFailure(
				"invalid-args",
				`shell.spawn: every "args" entry must be a string without a null byte, ` +
					`got ${JSON.stringify(item)}`,
			);
		}
		argv.push(item);
	}
	return { ok: true, argv };
}

export function parseSpawn(args: unknown, rules: ShellRules): SpawnPlan | ShellFailure {
	if (typeof args !== "object" || args === null) {
		return shellFailure(
			"invalid-args",
			"shell.spawn needs { program, args?, cwd?, env?, stdin? }",
		);
	}
	const source = args as {
		program?: unknown;
		args?: unknown;
		cwd?: unknown;
		env?: unknown;
		stdin?: unknown;
	};
	const program = source.program;
	if (typeof program !== "string" || program.length === 0 || program.includes("\0")) {
		return shellFailure(
			"invalid-args",
			`shell.spawn: "program" must be a non-empty string, got ${JSON.stringify(program)}`,
		);
	}

	if (source.cwd !== undefined && typeof source.cwd !== "string") {
		return shellFailure(
			"invalid-args",
			`shell.spawn: "cwd" must be a string, got ${JSON.stringify(source.cwd)}`,
		);
	}
	const dir = resolveCwd(rules, source.cwd);
	if (!dir.ok) return dir;

	if (source.stdin !== undefined && source.stdin !== "pipe" && source.stdin !== "ignore") {
		return shellFailure(
			"invalid-args",
			`shell.spawn: "stdin" must be "pipe" or "ignore", got ${JSON.stringify(source.stdin)}`,
		);
	}

	const parsedArgs = readArgs(source.args);
	if (!parsedArgs.ok) return parsedArgs;

	const target = resolveProgram(rules, program, dir.cwd);
	if (!target.ok) return target;

	const env = readEnv(source.env, rules.env);
	if (!env.ok) return env;

	return {
		ok: true,
		cmd: [target.path, ...parsedArgs.argv],
		cwd: dir.cwd,
		env: env.env,
		pipe: source.stdin === "pipe",
	};
}
