/**
 * The gate's job is to report what the suite did. `bun test` writes its totals to stderr,
 * so a stdout-only read leaves "totals not parsed" — the exact regression this guards.
 */
import { expect, mock, test } from "bun:test";

const calls: string[] = [];
const steps: { label: string; detail: string }[] = [];

mock.module("./git.ts", () => ({
	sh: async (cmd: string[]) => {
		calls.push(`sh ${cmd.join(" ")}`);
		// stdout only: this is what the old gate read, and it has no totals.
		return "";
	},
	shAll: async (cmd: string[]) => {
		calls.push(`shAll ${cmd.join(" ")}`);
		// bun test's totals arrive on stderr; shAll is the helper that reads both.
		return "bun test v1.3\n\n 6 pass\n 0 fail\n 20 expect() calls\n";
	},
	step: (label: string, detail: string) => {
		steps.push({ label, detail });
	},
	fail: (label: string, detail: string) => {
		steps.push({ label: `FAIL ${label}`, detail });
	},
	failureCount: () => 0,
}));

const { gate } = await import("./gate.ts");

test("gate reads bun test's stderr totals through shAll", async () => {
	calls.length = 0;
	steps.length = 0;
	await gate();
	expect(calls).toContain("shAll bun run test");
	expect(calls).not.toContain("sh bun run test");
	expect(steps.find(({ label }) => label === "test")?.detail).toBe("6 passed, 0 failed");
});
