/**
 * `crust:shell`'s path rules, and the division of labour between them:
 * - the allow list decides **what** may run, as an absolute real path — an allow-listed program runs wherever it lives, so `/opt/homebrew/bin/ffmpeg` needs no `cwdRoot` containing it;
 * - `cwdRoot` decides **where** a working directory and a *relative* program path may point, because a relative path means something only against a `cwd` the page supplies.
 * The list is canonicalised once, so a basename no longer satisfies it — a `/tmp/echo` the page planted is not `echo` — and every check and the spawn itself use the same resolved path.
 */

import { realpathSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

import { type ShellFailure, shellFailure } from "./shell-failure";

/** What `createShellPlugin` decided a page may run, already canonicalised. */
export interface ShellRules {
	/** Every entry resolved to an absolute real path; a program must be one of these. */
	allowed: ReadonlySet<string>;
	/** The entries that resolved, which is the only list a refusal may advertise. */
	advertised: readonly string[];
	/** `cwdRoot` as a real path, so containment compares like with like. */
	root: string;
	/** Whether a page may supply `env` at all. */
	env: boolean;
}

export interface ShellRuleOptions {
	/** Program names and absolute paths the host allows; an empty or absent list allows nothing. */
	allow?: readonly string[];
	/** Directory every `cwd` and every relative program path must resolve inside. */
	cwdRoot?: string;
	/** The host's opt-in for a page-supplied `env`; the loader and shell names stay refused. */
	env?: boolean;
}

/** A path's real path, or `undefined` when it does not exist. */
function real(path: string): string | undefined {
	try {
		return realpathSync(path);
	} catch {
		return undefined;
	}
}

/** A program with a separator is a path; anything else is a name looked up on PATH. */
function pathForm(program: string): boolean {
	return program.includes("/") || program.includes("\\");
}

/** A resolved path is inside `root`, or is `root` itself. */
function inside(path: string, root: string): boolean {
	return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/** The absolute real path an allow entry names: a PATH lookup for a name, a real path for a path. */
function canonical(entry: string): string | undefined {
	if (pathForm(entry)) {
		const absolute = resolve(entry);
		return real(absolute) ?? absolute;
	}
	const found = Bun.which(entry);
	return found === null ? undefined : (real(found) ?? resolve(found));
}

/**
 * Canonicalise the host's rules once. A root that does not resolve yet keeps its lexical form, so a `cwd` inside it is still refused for the right reason.
 */
export function shellRules(options: ShellRuleOptions = {}): ShellRules {
	const allowed = new Set<string>();
	const advertised: string[] = [];
	for (const entry of options.allow ?? []) {
		const path = canonical(entry);
		if (path === undefined) continue;
		allowed.add(path);
		advertised.push(entry);
	}
	const named = resolve(options.cwdRoot ?? process.cwd());
	return { allowed, advertised, root: real(named) ?? named, env: options.env === true };
}

/** The `cwd` a spawn runs in, or the refusal to answer with. */
export function resolveCwd(
	rules: ShellRules,
	cwd: string | undefined,
): { ok: true; cwd: string } | ShellFailure {
	const lexical = resolve(rules.root, cwd ?? ".");
	const actual = real(lexical);
	const shown = actual ?? lexical;
	if (!inside(shown, rules.root)) {
		const via = actual === undefined || actual === lexical ? "" : " through a symlink";
		return shellFailure(
			"cwd-not-allowed",
			`shell.spawn: cwd ${JSON.stringify(cwd)} resolves${via} to ${shown}, ` +
				`outside cwdRoot ${rules.root}`,
		);
	}
	if (actual === undefined) {
		return shellFailure(
			"cwd-not-allowed",
			`shell.spawn: cwd ${JSON.stringify(cwd)} resolves to ${lexical}, which does not exist`,
		);
	}
	return { ok: true, cwd: actual };
}

function notAllowed(program: string, rules: ShellRules, resolved?: string): ShellFailure {
	const detail =
		resolved === undefined || resolved === program
			? ""
			: ` (${JSON.stringify(program)} resolves to ${resolved})`;
	return shellFailure(
		"program-not-allowed",
		`shell.spawn: ${JSON.stringify(program)} is not in the allow list${detail}; ` +
			`createShellPlugin names the programs a page may run (allowed: ${rules.advertised.join(", ") || "none"})`,
	);
}

function outsideRoot(
	program: string,
	resolved: string,
	rules: ShellRules,
	viaSymlink: boolean,
): ShellFailure {
	return shellFailure(
		"program-outside-root",
		`shell.spawn: ${JSON.stringify(program)} resolves${viaSymlink ? " through a symlink" : ""} ` +
			`to ${resolved}, outside cwdRoot ${rules.root}`,
	);
}

/**
 * The real path a spawn must execute, or the refusal to answer with.
 * A bare name is looked up on PATH and an absolute path is taken as written: both are answered by the allow list alone, because that list is what says *what* may run. Only a relative path is also held to `cwdRoot`, since its target depends on a `cwd` the page supplies. The answer is the real path — the one the allow list was compared against and the one `Bun.spawn` is handed.
 */
export function resolveProgram(
	rules: ShellRules,
	program: string,
	cwd: string,
): { ok: true; path: string } | ShellFailure {
	if (!pathForm(program)) {
		const found = Bun.which(program);
		if (found === null) {
			return shellFailure(
				"spawn-failed",
				`shell.spawn: ${JSON.stringify(program)} is not on PATH`,
			);
		}
		const actual = real(found) ?? resolve(found);
		if (!rules.allowed.has(actual)) return notAllowed(program, rules, actual);
		return { ok: true, path: actual };
	}

	if (isAbsolute(program)) {
		const actual = real(resolve(program));
		if (actual === undefined) {
			return shellFailure(
				"spawn-failed",
				`shell.spawn: ${JSON.stringify(program)} does not exist`,
			);
		}
		if (!rules.allowed.has(actual)) return notAllowed(program, rules, actual);
		return { ok: true, path: actual };
	}

	const lexical = resolve(cwd, program);
	if (!inside(lexical, rules.root)) return outsideRoot(program, lexical, rules, false);
	const actual = real(lexical);
	if (actual === undefined) {
		return shellFailure(
			"spawn-failed",
			`shell.spawn: ${JSON.stringify(program)} resolves to ${lexical}, which does not exist`,
		);
	}
	if (!inside(actual, rules.root)) return outsideRoot(program, actual, rules, actual !== lexical);
	if (!rules.allowed.has(actual)) return notAllowed(program, rules, actual);
	return { ok: true, path: actual };
}
