/**
 * How a guard launch is told apart from a normal one. A compiled app cannot run this file, so the
 * marker is the only signal it has; these tests pin the marker's shape in a checkout, where the whole
 * path is observable. The end-to-end proof of a compiled binary is the built probe, not this file.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	GUARD_PID_VAR,
	GUARD_ROOT_VAR,
	guardLaunch,
	guardTarget,
	runCrashGuardIfMarked,
} from "@/runtime-crash-guard";

describe("guard launch", () => {
	test("a checkout runs this file, and carries the marker for a compiled app too", () => {
		const launch = guardLaunch(4242, "/tmp/root");
		expect(launch.cmd).toEqual([
			process.execPath,
			join(import.meta.dir, "runtime-crash-guard.ts"),
			"--guard",
			"--pid",
			"4242",
			"--root",
			"/tmp/root",
		]);
		expect(launch.env[GUARD_PID_VAR]).toBe("4242");
		expect(launch.env[GUARD_ROOT_VAR]).toBe("/tmp/root");
	});

	test("the marker is read from the environment, which is all a compiled app can carry", () => {
		expect(guardTarget({ [GUARD_PID_VAR]: "77", [GUARD_ROOT_VAR]: "/tmp/r" })).toEqual({
			pid: 77,
			root: "/tmp/r",
		});
	});

	test("argv is the fallback a hand-run guard uses", () => {
		expect(guardTarget({}, ["--guard", "--pid", "9", "--root", "/tmp/r"])).toEqual({
			pid: 9,
			root: "/tmp/r",
		});
	});

	test("a normal launch is not a guard, and a half-written marker is refused", () => {
		expect(guardTarget({})).toBeNull();
		expect(guardTarget({ [GUARD_PID_VAR]: "0", [GUARD_ROOT_VAR]: "/tmp/r" })).toBeNull();
		expect(guardTarget({ [GUARD_PID_VAR]: "12" })).toBeNull();
		expect(guardTarget({ [GUARD_PID_VAR]: "12", [GUARD_ROOT_VAR]: "" })).toBeNull();
	});

	test("runCrashGuardIfMarked answers false without the marker, so a real launch proceeds", async () => {
		expect(await runCrashGuardIfMarked({})).toBe(false);
	});
});
