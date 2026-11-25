/**
 * The gate's job is to report what every step did — and to leave a failure count the
 * release script checks before it bumps a version. `bun test` writes its totals to
 * stderr, so a stdout-only read leaves "totals not parsed" — the exact regression this guards.
 */
import { expect, mock, test } from "bun:test";

const calls: string[] = [];
const steps: { label: string; detail: string }[] = [];
let failCommand: string | undefined;
let failures = 0;

mock.module("./git.ts", () => ({
	sh: async (cmd: string[]) => {
		calls.push(`sh ${cmd.join(" ")}`);
		// stdout only: this is what the old gate read, and it has no totals.
		return "";
	},
	shAll: async (cmd: string[]) => {
		calls.push(`shAll ${cmd.join(" ")}`);
		if (failCommand !== undefined && cmd.includes(failCommand))
			throw new Error(`${cmd.join(" ")} exited 1: ${failCommand} refused`);
		// bun test's totals arrive on stderr; shAll is the helper that reads both.
		return "bun test v1.3\n\n 6 pass\n 0 fail\n 20 expect() calls\n";
	},
	step: (label: string, detail: string) => {
		steps.push({ label, detail });
	},
	fail: (label: string, detail: string) => {
		failures++;
		steps.push({ label: `FAIL ${label}`, detail });
	},
	failureCount: () => failures,
}));

const { gate } = await import("./gate.ts");
const { failureCount } = await import("./git.ts");

/** Dropping any row from SUMMARIES, most of all verify:package, must turn this list red. */
const ALL_STEPS = [
	"shAll bun check",
	"shAll bun run test",
	"shAll bun run verify:package",
	"shAll bun run skill:check",
];

function reset(): void {
	calls.length = 0;
	steps.length = 0;
	failCommand = undefined;
	failures = 0;
}

test("the gate runs every step, in order, through shAll", async () => {
	reset();
	await gate();
	expect(calls).toEqual(ALL_STEPS);
	expect(steps.map(({ label }) => label)).toEqual([
		"check",
		"test",
		"verify:package",
		"skill:check",
	]);
});

test("gate reads bun test's stderr totals through shAll", async () => {
	reset();
	await gate();
	expect(calls).toContain("shAll bun run test");
	expect(calls).not.toContain("sh bun run test");
	expect(steps.find(({ label }) => label === "test")?.detail).toBe("6 passed, 0 failed");
});

test("the gate checks the installed tarball, the step that caught 0.2.14", async () => {
	reset();
	await gate();
	expect(calls).toContain("shAll bun run verify:package");
});

test("the gate checks the committed SKILL.md command table", async () => {
	reset();
	await gate();
	expect(calls).toContain("shAll bun run skill:check");
});

test("a failed step is recorded and raises the count a release checks", async () => {
	reset();
	failCommand = "verify:package";
	await gate();
	expect(steps).toContainEqual({
		label: "FAIL verify:package",
		detail: "bun run verify:package exited 1: verify:package refused",
	});
	expect(steps.find(({ label }) => label === "verify:package")).toBeUndefined();
	expect(failureCount()).toBe(1);
	// The remaining steps still run, so one log carries every failure, not only the first.
	expect(calls).toEqual(ALL_STEPS);
});

test("the release script stops on that count before it bumps or tags", async () => {
	const source = await Bun.file(new URL("../release.ts", import.meta.url)).text();
	const gateAt = source.indexOf("await gate();");
	const abortAt = source.indexOf("if (failureCount() > 0) process.exit(1);");
	const bumpAt = source.indexOf("// ---- 3. Bump");
	expect(gateAt).toBeGreaterThan(-1);
	expect(abortAt).toBeGreaterThan(gateAt);
	expect(abortAt).toBeLessThan(bumpAt);
});
