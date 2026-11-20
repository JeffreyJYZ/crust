/**
 * The precedence chain, and the dev default it replaces. `resolveLogLevel` is pure, so the order is
 * asserted without a process; the two `configureLogger` cases prove the logger reads it the same
 * way — `CRUST_LOG` beats `logging.level`, and dev at the default starts at `info`.
 */

import { afterEach, describe, expect, test } from "bun:test";

import { configureLogger, loggerLevel, resetLogger, resolveLogLevel } from "@/logging";

afterEach(() => {
	delete process.env.CRUST_LOG;
	resetLogger();
});

describe("resolveLogLevel", () => {
	test("the flag wins over env, which wins over config", () => {
		expect(resolveLogLevel({ flag: "warn", env: "debug", config: "trace" })).toBe("warn");
		expect(resolveLogLevel({ env: "debug", config: "trace" })).toBe("debug");
		expect(resolveLogLevel({ config: "trace" })).toBe("trace");
	});

	test("nothing recognised is info, the default for a build and for dev", () => {
		expect(resolveLogLevel({})).toBe("info");
		expect(resolveLogLevel({ flag: "loud", env: "noisy", config: "chatty" })).toBe("info");
	});
});

describe("the process logger", () => {
	test("CRUST_LOG beats logging.level", () => {
		process.env.CRUST_LOG = "debug";
		configureLogger({ level: "warn" });
		expect(loggerLevel()).toBe("debug");
	});

	test("logging.level applies when no env is set, and dev does not raise it", () => {
		configureLogger({ level: "warn", dev: true });
		expect(loggerLevel()).toBe("warn");
	});

	test("dev with nothing configured starts at info, not debug", () => {
		configureLogger({ dev: true });
		expect(loggerLevel()).toBe("info");
	});
});
