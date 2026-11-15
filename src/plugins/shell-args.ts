/**
 * `crust:shell`'s argument reading and its allowlist rules. A page payload is whatever the bridge parsed, so every reader answers a typed failure instead of throwing, and a program is refused before any process exists.
 */

import { isAbsolute, resolve, sep } from "node:path";

export interface SpawnArgs {
	program: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
}

export type ShellFailureCode =
	| "invalid-args"
	| "program-not-allowed"
	| "program-outside-root"
	| "cwd-not-allowed"
	| "spawn-failed"
	| "unknown-process";

/** The refusal shape every `crust:shell` command answers with. */
export interface ShellFailure {
	ok: false;
	code: ShellFailureCode;
	message: string;
}

export function shellFailure(code: ShellFailureCode, message: string): ShellFailure {
	return { ok: false, code, message };
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

/** What `spawn` hands `Bun.spawn`, already checked. */
export interface SpawnPlan {
	ok: true;
	cmd: string[];
	cwd: string;
	env: Record<string, string>;
}

export interface ShellRules {
	/** Program names a page may run, matched as basenames. */
	allow: readonly string[];
	/** Absolute directory every `cwd` and path-form program must stay inside. */
	root: string;
}

/** A resolved path is inside `root`, or is `root` itself. */
function inside(path: string, root: string): boolean {
	return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

function notAllowed(program: string, allow: readonly string[]): ShellFailure {
	return shellFailure(
		"program-not-allowed",
		`shell.spawn: ${JSON.stringify(program)} is not in the allow list; ` +
			`createShellPlugin names the programs a page may run (allowed: ${allow.join(", ") || "none"})`,
	);
}

export function parseSpawn(args: unknown, rules: ShellRules): SpawnPlan | ShellFailure {
	if (typeof args !== "object" || args === null) {
		return shellFailure("invalid-args", "shell.spawn needs { program, args?, cwd?, env? }");
	}
	const source = args as { program?: unknown; args?: unknown; cwd?: unknown; env?: unknown };
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
	const cwd = resolve(rules.root, source.cwd ?? ".");
	if (!inside(cwd, rules.root)) {
		return shellFailure(
			"cwd-not-allowed",
			`shell.spawn: cwd ${JSON.stringify(source.cwd)} resolves to ${cwd}, ` +
				`outside cwdRoot ${rules.root}`,
		);
	}

	// A bare name is looked up on PATH; anything with a separator is a path, and
	// it must both keep an allowed basename and resolve inside the root.
	let target = program;
	if (program.includes("/") || program.includes("\\")) {
		const base = program.split(/[\\/]/).pop() ?? "";
		if (!rules.allow.includes(base)) return notAllowed(program, rules.allow);
		target = isAbsolute(program) ? resolve(program) : resolve(cwd, program);
		if (!inside(target, rules.root)) {
			return shellFailure(
				"program-outside-root",
				`shell.spawn: ${JSON.stringify(program)} resolves to ${target}, ` +
					`outside cwdRoot ${rules.root}`,
			);
		}
	} else if (!rules.allow.includes(program)) {
		return notAllowed(program, rules.allow);
	}

	const argv: string[] = [];
	if (source.args !== undefined) {
		if (!Array.isArray(source.args)) {
			return shellFailure("invalid-args", 'shell.spawn: "args" must be an array of strings');
		}
		for (const item of source.args) {
			if (typeof item !== "string" || item.includes("\0")) {
				return shellFailure(
					"invalid-args",
					`shell.spawn: every "args" entry must be a string without a null byte, ` +
						`got ${JSON.stringify(item)}`,
				);
			}
			argv.push(item);
		}
	}

	const env: Record<string, string> = {};
	if (source.env !== undefined) {
		if (typeof source.env !== "object" || source.env === null || Array.isArray(source.env)) {
			return shellFailure("invalid-args", 'shell.spawn: "env" must be an object of strings');
		}
		for (const [key, value] of Object.entries(source.env)) {
			if (typeof value !== "string") {
				return shellFailure(
					"invalid-args",
					`shell.spawn: env ${JSON.stringify(key)} must be a string, ` +
						`got ${JSON.stringify(value)}`,
				);
			}
			env[key] = value;
		}
	}

	return { ok: true, cmd: [target, ...argv], cwd, env };
}
