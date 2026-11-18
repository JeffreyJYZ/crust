/**
 * `crust:shell`'s environment rules: a page-supplied `env` is refused unless the host opted in, and even then the names that make a permitted program load a file of the caller's choosing are refused one by one, by name.
 * Those names are why the allow list alone is decoration: `NODE_OPTIONS=--require /tmp/evil.js` runs a script, `BASH_ENV` and `ENV` are sourced by a shell, `GIT_EXEC_PATH` swaps git's own subcommands, `PYTHONSTARTUP`, `PERL5OPT` and `RUBYOPT` are code, and `LD_PRELOAD` or any `DYLD_*` replaces the loader's libraries.
 */

import { type ShellFailure, shellFailure } from "./shell-failure";

/** Names that turn any allowlisted program into an execution primitive, whatever the program is. */
const INJECTION = [
	"NODE_OPTIONS", // --require / --import a file of the caller's choosing
	"BASH_ENV", // sourced by bash before the program runs
	"ENV", // sourced by sh
	"GIT_EXEC_PATH", // where git looks for its own subcommands
	"PYTHONSTARTUP", // run by an interactive python
	"PERL5OPT", // -M… switches for perl
	"RUBYOPT", // -r… switches for ruby
	"LD_PRELOAD", // the libraries the Linux loader loads first
	"LD_LIBRARY_PATH", // the libraries the Linux loader prefers
] as const;

/** `DYLD_*` is a family, not a name: every member redirects or injects a library on macOS. */
const DYLD_PREFIX = "dyld_";

// Windows environment names are case-insensitive, so `node_options` reaches Node as NODE_OPTIONS.
// Compare folded names; the caller's original spelling still goes into the refusal message.
const INJECTION_FOLDED = INJECTION.map((name) => name.toLowerCase());

function injection(key: string): boolean {
	const folded = key.toLowerCase();
	return folded.startsWith(DYLD_PREFIX) || INJECTION_FOLDED.some((name) => name === folded);
}

export type EnvPlan = { ok: true; env: Record<string, string> } | ShellFailure;

/**
 * Read `env` from a page payload. `allowed` is the host's opt-in; without it the whole object is refused rather than filtered, because a page asking for `env` is asking to configure a program and there is no benign subset to guess at.
 * The shape is checked before the opt-in, so a malformed payload stays `invalid-args` whatever the host configured, and the injection names are named only once the host has opted in — the case where a page could otherwise reach them.
 */
export function readEnv(value: unknown, allowed: boolean): EnvPlan {
	if (value === undefined) return { ok: true, env: {} };
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return shellFailure("invalid-args", 'shell.spawn: "env" must be an object of strings');
	}
	const env: Record<string, string> = {};
	for (const [key, item] of Object.entries(value)) {
		if (typeof item !== "string") {
			return shellFailure(
				"invalid-args",
				`shell.spawn: env ${JSON.stringify(key)} must be a string, got ${JSON.stringify(item)}`,
			);
		}
		env[key] = item;
	}
	if (!allowed) {
		return shellFailure(
			"env-not-allowed",
			'shell.spawn: "env" is not available to a page; createShellPlugin({ env: true }) is the ' +
				"app's opt-in, and the loader and shell variables stay refused even then",
		);
	}
	for (const key of Object.keys(env)) {
		if (!injection(key)) continue;
		return shellFailure(
			"env-not-allowed",
			`shell.spawn: env ${JSON.stringify(key)} is refused — it makes a permitted program load ` +
				"and run a file of the caller's choosing, which would leave the allow list bounding nothing",
		);
	}
	return { ok: true, env };
}
