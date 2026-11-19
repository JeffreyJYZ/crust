/**
 * A child that dies at the deadline is a kill, not a clean exit. The kill's own exit code must
 * never reach a caller as `code === 0`, or an e2e `exit 0` assertion reads a killed app as a pass.
 * A child that really exits 0 on its own — including when the probe stops it after a match — must
 * keep reporting 0, so the fix cannot simply null every code.
 */
import { expect, test } from "bun:test";
import { probe } from "./probe.ts";

/** Answers SIGTERM with 0, but never prints the proving line. */
const STUBBORN = [
	process.execPath,
	"-e",
	"process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1_000);",
];

/** Prints the proving line, then answers the probe's SIGTERM with 0. */
const CLEAN = [
	process.execPath,
	"-e",
	"process.on('SIGTERM', () => process.exit(0)); console.log('ready now'); setInterval(() => {}, 1_000);",
];

test("a deadline kill reports code null, never the child's SIGTERM exit 0", async () => {
	const result = await probe({
		command: STUBBORN,
		cwd: import.meta.dir,
		match: /never printed/,
		timeoutMs: 150,
		graceMs: 500,
	});
	expect(result.timedOut).toBe(true);
	expect(result.ended).toBe("timeout");
	expect(result.code).toBeNull();
});

test("a child stopped after its proving line still reports its real exit 0", async () => {
	const result = await probe({
		command: CLEAN,
		cwd: import.meta.dir,
		match: /ready now/,
		timeoutMs: 2_000,
	});
	expect(result.matched).not.toBeNull();
	expect(result.timedOut).toBe(false);
	expect(result.code).toBe(0);
});
