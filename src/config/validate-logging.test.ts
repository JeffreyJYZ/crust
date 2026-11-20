/**
 * `logging` config is validated like every other section: a bad level or an absolute `dir` is a
 * startup failure naming the key, not a silent fallback. `dir` is relative to the app data root by
 * contract, so an absolute one would write somewhere the app's own data does not live.
 */

import { describe, expect, test } from "bun:test";

import { ConfigError, validateConfig } from "@/config";

const BASE = {
	app: { id: "land.jyz.log", name: "log", version: "1.0.0" },
	windows: [{ label: "main" }],
};

function configWith(logging: unknown): unknown {
	return { ...BASE, logging };
}

describe("config logging", () => {
	test("accepts a level, a boolean console, a relative dir and the two sizes", () => {
		expect(() =>
			validateConfig(
				configWith({
					level: "debug",
					console: true,
					dir: "logs",
					generations: 3,
					maxBytes: 1024,
				}),
			),
		).not.toThrow();
		expect(() => validateConfig(BASE)).not.toThrow();
	});

	test("refuses an unknown level and names the key", () => {
		try {
			validateConfig(configWith({ level: "verbose" }));
			throw new Error("expected a refusal");
		} catch (error) {
			expect(error).toBeInstanceOf(ConfigError);
			expect((error as ConfigError).message).toContain("logging.level");
		}
	});

	test("refuses an absolute dir, a non-boolean console and a zero generation count", () => {
		expect(() => validateConfig(configWith({ dir: "/tmp/logs" }))).toThrow(/logging\.dir/);
		expect(() => validateConfig(configWith({ console: "yes" }))).toThrow(/logging\.console/);
		expect(() => validateConfig(configWith({ generations: 0 }))).toThrow(
			/logging\.generations/,
		);
		expect(() => validateConfig(configWith({ unknown: 1 }))).toThrow(/logging\.unknown/);
	});
});
