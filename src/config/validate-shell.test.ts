import { describe, expect, test } from "bun:test";

import { ConfigError, validateConfig } from "@/config";

const base = {
	app: { id: "dev.crust.shell", name: "Shell", version: "0.0.0" },
	windows: [{ label: "main" }],
};

function withShell(shell: unknown): unknown {
	return { ...base, shell };
}

describe("shell config", () => {
	test("accepts a bare name, an absolute path and a cwdRoot", () => {
		const config = validateConfig(
			withShell({ allow: ["echo", "/usr/bin/echo"], cwdRoot: "/tmp" }),
		);
		expect(config.shell).toEqual({ allow: ["echo", "/usr/bin/echo"], cwdRoot: "/tmp" });
	});

	test("an empty section is valid and allows nothing", () => {
		expect(validateConfig(withShell({})).shell).toEqual({});
	});

	test("refuses a relative path entry, because the page supplies the cwd", () => {
		expect(() => validateConfig(withShell({ allow: ["./bin/tool"] }))).toThrow(
			/shell\.allow\[0\]/,
		);
	});

	test("refuses an empty or non-string entry", () => {
		expect(() => validateConfig(withShell({ allow: [""] }))).toThrow(/shell\.allow\[0\]/);
		expect(() => validateConfig(withShell({ allow: [7] }))).toThrow(/shell\.allow\[0\]/);
	});

	test("refuses allow that is not an array", () => {
		expect(() => validateConfig(withShell({ allow: "echo" }))).toThrow(/shell\.allow/);
	});

	test("refuses a cwdRoot that is not a non-empty string", () => {
		expect(() => validateConfig(withShell({ cwdRoot: 5 }))).toThrow(/shell\.cwdRoot/);
	});

	test("refuses an unknown key, like every other section", () => {
		expect(() => validateConfig(withShell({ allow: ["echo"], nope: true }))).toThrow(
			ConfigError,
		);
	});
});
