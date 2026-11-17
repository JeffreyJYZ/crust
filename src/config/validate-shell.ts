import { isAbsolute } from "node:path";

import type { Validator } from "./validator.ts";

export const SHELL_KEYS = ["allow", "cwdRoot"] as const;

/**
 * Programs that are a language rather than a tool. Allowlisting one hands the page every binary and
 * every file this process can reach — `sh -c`, `node -e`, `python -c` — so the allow list stops
 * bounding what runs, however short it is. A version suffix is common (`python3.12`, `node20`).
 */
const INTERPRETER =
	/^(?:sh|bash|zsh|dash|ksh|fish|csh|tcsh|env|node|nodejs|bun|deno|python[0-9.]*|perl[0-9.]*|ruby[0-9.]*|php[0-9.]*|lua[0-9.]*|osascript|pwsh|Rscript)$/i;

/** The program name an entry names, whether it is a bare name or an absolute path. */
function baseName(entry: string): string {
	return entry.split(/[\\/]/).pop() ?? entry;
}

/**
 * A program entry is a bare name or an absolute path. A relative path would be
 * resolved against a `cwd` the page supplies, so the same entry would name
 * different programs; the runtime refuses those, and so does this.
 *
 * An interpreter is accepted but warned about, never refused: an app that ships
 * one deliberately is its own decision, and a refusal would only be worked around
 * by allowlisting the same binary under another name.
 */
export function validateShell(v: Validator, value: unknown): void {
	if (value === undefined) return;
	const shell = v.object("shell", value);
	if (!shell) return;
	v.only(shell, "shell", SHELL_KEYS);
	const cwdRoot = v.string(shell, "cwdRoot", "shell", false);
	// The consumer resolves cwdRoot against process.cwd(), which is the project under `crust dev` but `/` in a
	// built app — so a relative root draws a different boundary in each. Refuse it here, as fs.scope does.
	if (cwdRoot !== undefined && !isAbsolute(cwdRoot)) {
		v.fail("shell.cwdRoot", "an absolute path", cwdRoot);
	}

	const allow = shell.allow;
	if (allow === undefined) return;
	if (!Array.isArray(allow)) {
		v.fail("shell.allow", "an array of program names", allow);
		return;
	}
	allow.forEach((item, index) => {
		const path = `shell.allow[${index}]`;
		if (typeof item !== "string" || item.trim() === "") {
			v.fail(path, "a non-empty string", item);
			return;
		}
		if ((item.includes("/") || item.includes("\\")) && !isAbsolute(item)) {
			v.fail(path, "a bare program name or an absolute path", item);
			return;
		}
		const base = baseName(item);
		if (!INTERPRETER.test(base)) return;
		console.warn(
			`crust config: ${path} ${JSON.stringify(item)} is an interpreter — ` +
				`allowing ${base} lets a page run any program and read any file this app can reach, ` +
				"so the allow list no longer bounds what runs",
		);
	});
}
