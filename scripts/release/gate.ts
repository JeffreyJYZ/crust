/**
 * The fast half of the gate. e2e suites need a desktop session and minutes; they
 * are run by hand before a release, and CI runs them on every PR.
 */
import { fail, shAll, step } from "./git.ts";

/**
 * The summary matters more than the last line: a test that prints to stdout
 * leaves its own output after bun's totals, and "before true" is not a verdict.
 */
const SUMMARIES = [
	[
		"check",
		["bun", "check"],
		(out: string) => out.split("\n").find((row) => row.includes("No type errors")) ?? "ok",
	],
	[
		"test",
		["bun", "run", "test"],
		(out: string) => {
			// bun test paints its totals, and the escape codes sit between the count and
			// the word often enough that a raw match reports "? passed" — which is how a
			// release log claimed nothing at all about the suite it had just run.
			const plain = out.replaceAll(/\u001b\[[0-9;]*m/g, "");
			const passed = /(\d+)\s+pass/.exec(plain)?.[1] ?? "?";
			const failed = /(\d+)\s+fail/.exec(plain)?.[1] ?? "?";
			if (passed === "?" || failed === "?") return `ran, totals not parsed (exit 0)`;
			return `${passed} passed, ${failed} failed`;
		},
	],
	[
		// The committed SKILL.md is an installable deliverable, not a generated file.
		"skill:check",
		["bun", "run", "skill:check"],
		(out: string) => out.trim() || "ok",
	],
] as const;

export async function gate(): Promise<void> {
	for (const [label, cmd, summarise] of SUMMARIES) {
		try {
			// `bun test` writes its totals to stderr, so stdout alone leaves `? passed`.
			const out = await shAll([...cmd]);
			step(label, summarise(out));
		} catch (error) {
			fail(label, error instanceof Error ? error.message : String(error));
		}
	}
}
