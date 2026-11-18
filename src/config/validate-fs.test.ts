import { describe, expect, test } from "bun:test";
import { ConfigError, validateConfig, type CrustConfig } from "@/config";

const base = {
	app: { id: "dev.crust.fs", name: "FS", version: "0.0.0" },
	windows: [{ label: "main" }],
};

function issue(fs: unknown): { path: string; expected: string } | undefined {
	try {
		validateConfig({ ...base, fs });
		return undefined;
	} catch (error) {
		expect(error).toBeInstanceOf(ConfigError);
		return (error as ConfigError).issues[0];
	}
}

describe("fs.scope validation", () => {
	test("absolute directory prefixes are carried through unchanged", () => {
		const config = validateConfig({ ...base, fs: { scope: ["/tmp/project", "/Users/shared"] } });
		expect((config as CrustConfig & { fs: { scope: string[] } }).fs.scope).toEqual([
			"/tmp/project",
			"/Users/shared",
		]);
	});

	test("a relative grant is refused and names the entry", () => {
		expect(issue({ scope: ["relative/path"] })?.path).toBe("fs.scope[0]");
	});

	test("an empty or non-string entry is refused by name", () => {
		expect(issue({ scope: ["  "] })?.path).toBe("fs.scope[0]");
		expect(issue({ scope: [42] })?.path).toBe("fs.scope[0]");
	});

	test("a non-array scope names fs.scope", () => {
		expect(issue({ scope: "/tmp" })?.path).toBe("fs.scope");
	});

	test("an unknown fs key names the key", () => {
		expect(issue({ scopes: ["/tmp"] })?.path).toBe("fs.scopes");
	});
});
