import { describe, expect, test } from "bun:test";

import { ConfigError, type TestingActivation, validateConfig } from "@/config";

const base = {
	app: { id: "dev.crust.testing", name: "Testing", version: "0.0.0" },
	windows: [{ label: "main" }],
};

function withTesting(testing: unknown): unknown {
	return { ...base, testing };
}

describe("testing.activation", () => {
	test("accepts each of the three modes", () => {
		for (const mode of ["auto", "none", "on-demand"] as const) {
			expect(validateConfig(withTesting({ activation: mode })).testing?.activation).toBe(
				mode as TestingActivation,
			);
		}
	});

	test("an absent section and an absent key are valid, so the default stays the platform's", () => {
		expect(validateConfig(base).testing).toBeUndefined();
		expect(validateConfig(withTesting({})).testing?.activation).toBeUndefined();
	});

	test("refuses anything else by name, naming the key and the accepted set", () => {
		for (const bad of ["sometimes", "Auto", "", 1, null, true]) {
			expect(() => validateConfig(withTesting({ activation: bad }))).toThrow(
				/testing\.activation/,
			);
		}
	});

	test("the refusal lists all three modes and what was there", () => {
		try {
			validateConfig(withTesting({ activation: "sometimes" }));
			throw new Error("expected a ConfigError");
		} catch (error) {
			expect(error).toBeInstanceOf(ConfigError);
			const [issue] = (error as ConfigError).issues;
			expect(issue?.path).toBe("testing.activation");
			expect(issue?.expected).toBe('one of "auto", "none", "on-demand"');
			expect(issue?.received).toBe('"sometimes"');
		}
	});

	test("refuses an unknown key inside the section", () => {
		expect(() => validateConfig(withTesting({ activation: "auto", focus: false }))).toThrow(
			/testing\.focus/,
		);
	});
});
