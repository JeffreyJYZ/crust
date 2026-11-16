import { describe, expect, spyOn, test } from "bun:test";

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

describe("shell config interpreters", () => {
	/** Capture what the validator says, and keep it off the test's own output. */
	function quiet(run: () => void): string[] {
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		try {
			run();
			return warn.mock.calls.map((call) => String(call[0]));
		} finally {
			warn.mockRestore();
		}
	}

	test("warns about an interpreter by entry, and still accepts the config", () => {
		let config: ReturnType<typeof validateConfig> | undefined;
		const said = quiet(() => {
			config = validateConfig(withShell({ allow: ["echo", "sh", "/bin/bash"] }));
		});
		expect(config?.shell).toEqual({ allow: ["echo", "sh", "/bin/bash"] });
		expect(said.length).toBe(2);
		expect(said[0]).toContain("shell.allow[1]");
		expect(said[0]).toContain("interpreter");
		expect(said[0]).toContain("no longer bounds what runs");
		expect(said[1]).toContain("shell.allow[2]");
	});

	test("says nothing when every entry is a tool", () => {
		const said = quiet(() => {
			validateConfig(withShell({ allow: ["echo", "/usr/bin/echo"] }));
		});
		expect(said).toEqual([]);
	});
});
