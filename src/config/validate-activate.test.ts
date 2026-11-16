import { describe, expect, test } from "bun:test";

import { type ActivateMode, ConfigError, validateConfig } from "@/config";

const base = {
	app: { id: "dev.crust.activate", name: "Activate", version: "0.0.0" },
	windows: [{ label: "main" }],
};

function withActivate(activate: unknown): unknown {
	return { ...base, app: { ...base.app, activate } };
}

describe("app.activate", () => {
	test("accepts each of the three modes", () => {
		for (const mode of ["always", "first", "never"] as const) {
			expect(validateConfig(withActivate(mode)).app.activate).toBe(mode as ActivateMode);
		}
	});

	test("an absent key is valid and stays absent, so the platform's default decides", () => {
		expect(validateConfig(base).app.activate).toBeUndefined();
	});

	test("refuses anything else by name, naming the key and the accepted set", () => {
		for (const bad of ["sometimes", "Always", "", 1, null, true]) {
			expect(() => validateConfig(withActivate(bad))).toThrow(/app\.activate/);
		}
	});

	test("the refusal lists all three modes and what was there", () => {
		try {
			validateConfig(withActivate("sometimes"));
			throw new Error("expected a ConfigError");
		} catch (error) {
			expect(error).toBeInstanceOf(ConfigError);
			const [issue] = (error as ConfigError).issues;
			expect(issue?.path).toBe("app.activate");
			expect(issue?.expected).toBe('one of "always", "first", "never"');
			expect(issue?.received).toBe('"sometimes"');
		}
	});
});
