/**
 * Two jobs, one file. The first half is the classification the guard test asserts: which scripts
 * under `scripts/` can put a window on the human's screen, and why the rest cannot. The second half
 * is the detector: it decides "can this file take the screen" from what the file DOES, not from a
 * name in a hand-maintained list. A throwaway probe at the repo root is invisible to a list, which
 * is exactly how a window was taken with no focus capture at all.
 */
import { type Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

// The tables live next door so this file stays under the cap; re-exported so the test's import
// surface does not move.
export { EXEMPT, LAUNCHERS } from "./focus-classification.ts";

/** The names an `import { … } from "./e2e-harness"` in a caller brings in. */
export function harnessImports(text: string): string[] {
	const names: string[] = [];
	for (const match of text.matchAll(
		/import\s*\{([^}]*)\}\s*from\s*"\.\/e2e-harness(?:\.ts)?"/g,
	)) {
		for (const name of (match[1] ?? "").split(",")) names.push(name.trim());
	}
	return names;
}

/** A way a probe can take the screen. `name` is quoted verbatim in the failure message. */
export interface ScreenRule {
	name: string;
	match: RegExp;
}

/**
 * Detection, not a list. Each rule is a launch verb plus a GUI marker, so a comment that merely
 * mentions `.app` or `dist/` does not count. Comments are stripped before a rule runs.
 */
export const SCREEN_RULES: ScreenRule[] = [
	{
		name: "spawns a built .app binary",
		match: /spawn(?:Sync)?\s*\(?[\s\S]{0,200}?\.app\/Contents\/MacOS\//,
	},
	{
		name: "spawns a path under dist/",
		match: /spawn(?:Sync)?\s*\(?[\s\S]{0,200}?["'`]dist\//,
	},
	{ name: "calls createNativeWindow", match: /\bcreateNativeWindow\s*\(/ },
	{
		name: "opens an app with `open -a`",
		match: /spawn(?:Sync)?\s*\(?[\s\S]{0,120}?["']open["'][\s\S]{0,40}?["']-a["']/,
	},
	{
		name: "runs crust dev/build then launches the result",
		match: /\bcrust\s+(?:dev|build)\b[\s\S]{0,300}?spawn(?:Sync)?\s*\(/,
	},
];

/** Remove comments so a rule cannot fire on prose describing a launch. Keeps `https://` intact. */
export function stripComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The rule a file trips, or undefined when nothing in it can take the screen. */
export function canTakeScreen(text: string): string | undefined {
	const source = stripComments(text);
	return SCREEN_RULES.find((rule) => rule.match.test(source))?.name;
}

/** The three accepted ways to hand focus back: the guard, a raw capture/restore pair, or probe-run. */
export function isArmed(text: string): boolean {
	return (
		text.includes("guardFocus()") ||
		(text.includes("captureFrontmost()") && text.includes("restoreFocus(")) ||
		text.includes("probe-run")
	);
}

/** Why this file is a violation, or undefined when it is safe or exempt. */
export function unarmedReason(text: string): string | undefined {
	const rule = canTakeScreen(text);
	return rule !== undefined && !isArmed(text) ? rule : undefined;
}

/** The failure line: it names the file and carries the fix, not just a bare FAIL. */
export function fixMessage(file: string, rule: string): string {
	return `${file}: ${rule}; run it under \`probe-run -c\`, or arm \`guardFocus()\` (a raw captureFrontmost()+restoreFocus() pair also works)`;
}

/** Probe-shaped locations: root-level one-offs, plus every runnable probe under these trees. */
export const SCAN_DIRS = ["examples", "research", "spike"] as const;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "target", ".git", ".next"]);

async function walk(dir: string, root: string, found: string[]): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) await walk(join(dir, entry.name), root, found);
		} else if (entry.isFile() && entry.name.endsWith(".ts")) {
			found.push(relative(root, join(dir, entry.name)));
		}
	}
}

/** Every candidate the detector reads, sorted: `.*.ts`, `*.probe.ts`, `probe*.ts`, plus the trees. */
export async function probeFiles(root: string = process.cwd()): Promise<string[]> {
	const found: string[] = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
		if (
			/^\..*\.ts$/.test(entry.name) ||
			/\.probe\.ts$/.test(entry.name) ||
			/^probe.*\.ts$/.test(entry.name)
		) {
			found.push(entry.name);
		}
	}
	for (const dir of SCAN_DIRS) await walk(join(root, dir), root, found);
	return found.sort();
}

/** One fix line per unarmed screen-taker under `root`; empty means the tree is clean. */
export async function findUnarmed(root: string = process.cwd()): Promise<string[]> {
	const failures: string[] = [];
	for (const file of await probeFiles(root)) {
		const text = await readFile(join(root, file), "utf8");
		const rule = unarmedReason(text);
		if (rule !== undefined) failures.push(fixMessage(file, rule));
	}
	return failures;
}
