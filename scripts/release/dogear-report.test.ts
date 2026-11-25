/**
 * A self-check line must reach stdout before `done`. The old reporter fired its
 * bridge write and returned, and the e2e killed the app on `done`, so the last
 * step could lose the race on a loaded runner. These guards pin both halves of
 * the fix: the reporter awaits its write, and the page awaits its reporter.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// The example is a .tsx app outside this repo's `include`; Bun runs it directly.
// @ts-expect-error - tsconfig has no jsx setting because src/ ships no JSX.
import { makeChecks } from "../../examples/dogear/src/selfcheck/checks";

const ROOT = join(import.meta.dir, "..", "..");

function source(path: string): string {
	return readFileSync(join(ROOT, path), "utf8");
}

test("a check does not answer before its report line is delivered", async () => {
	let release: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const delivered: string[] = [];
	const checks = makeChecks(async (line: string) => {
		await gate;
		delivered.push(line);
	});
	let answered = false;
	const pending = checks
		.check(
			"gated",
			async () => "value",
			() => "detail",
		)
		.then(() => {
			answered = true;
		});
	// Give the reporter a turn to start; it must still be holding the check.
	await Bun.sleep(0);
	expect(delivered).toEqual([]);
	expect(answered).toBe(false);
	release?.();
	await pending;
	expect(delivered).toEqual(["PASS gated — detail"]);
	expect(answered).toBe(true);
});

test("the page reporter awaits the terminal write", () => {
	const store = source("examples/dogear/src/store.tsx");
	expect(store).toContain("await logCommand(line)");
	expect(store).not.toContain("\n\t\tlogCommand(line).catch");
});

test("the page awaits done and every panel line", () => {
	const selfcheck = source("examples/dogear/src/selfcheck.tsx");
	expect(selfcheck).toContain('await report("done")');
	const panels = source("examples/dogear/src/selfcheck/panels.tsx");
	const calls = panels.match(/\b(?:pass|fail)\(/g) ?? [];
	const awaited = panels.match(/\bawait\s+(?:pass|fail)\(/g) ?? [];
	expect(calls.length).toBeGreaterThan(0);
	expect(awaited.length).toBe(calls.length);
});
