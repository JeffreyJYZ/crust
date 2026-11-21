/**
 * `doctor` must report the interpreter the build actually spawns. A standalone
 * crust binary with no `bun` on PATH gets a clean bill of health today while
 * `crust build` dies with "Executable not found in $PATH".
 */
import { describe, expect, test } from "bun:test";
import { bunCheck } from "./environment.ts";

describe("doctor bun check", () => {
	test("an unresolvable bun is a failure, not an ok with a version string", () => {
		const check = bunCheck(() => undefined);
		expect(check.status).toBe("fail");
		expect(check.detail).toContain("bun");
	});

	test("a resolved bun is ok and names that path", () => {
		const check = bunCheck(() => "/opt/homebrew/bin/bun");
		expect(check.status).toBe("ok");
		expect(check.detail).toContain("/opt/homebrew/bin/bun");
	});
});
