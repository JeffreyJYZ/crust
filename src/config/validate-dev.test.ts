/**
 * `dev.url` names the dev server the window loads in `crust dev`. A hostless string parses as a
 * scheme with no host and waits 30 s on an empty host; an unparseable string throws at run time.
 * Both are startup failures here, naming `dev.url` and the shape it must have.
 */

import { describe, expect, test } from "bun:test";
import { ConfigError, validateConfig, type CrustConfig } from "@/config";

const base = {
	app: { id: "dev.crust.devurl", name: "Dev URL", version: "0.0.0" },
	windows: [{ label: "main" }],
};

function issue(dev: unknown): { path: string; expected: string } | undefined {
	try {
		validateConfig({ ...base, dev });
		return undefined;
	} catch (error) {
		expect(error).toBeInstanceOf(ConfigError);
		return (error as ConfigError).issues[0];
	}
}

describe("dev.url validation", () => {
	test("accepts an absolute http(s) URL with a host", () => {
		const http = validateConfig({ ...base, dev: { url: "http://localhost:5173" } });
		expect((http as CrustConfig).dev?.url).toBe("http://localhost:5173");
		const https = validateConfig({ ...base, dev: { url: "https://example.com/app/" } });
		expect((https as CrustConfig).dev?.url).toBe("https://example.com/app/");
	});

	test("refuses a hostless string that parses as a scheme", () => {
		const found = issue({ url: "localhost:5173" });
		expect(found?.path).toBe("dev.url");
		expect(found?.expected).toContain("http(s)");
	});

	test("refuses a string that is not a URL at all", () => {
		const found = issue({ url: "not a url" });
		expect(found?.path).toBe("dev.url");
	});

	test("refuses a URL whose scheme is not http(s)", () => {
		for (const url of ["file:///tmp/index.html", "ws://localhost:5173", "ftp://example.com"]) {
			expect(issue({ url })?.path).toBe("dev.url");
		}
	});

	test("refuses an empty or non-string url by name", () => {
		expect(issue({ url: "  " })?.path).toBe("dev.url");
		expect(issue({ url: 42 })?.path).toBe("dev.url");
	});

	test("an absent url and an absent dev section still validate", () => {
		expect(issue({ beforeDevCommand: "bun run dev" })).toBeUndefined();
		expect(validateConfig(base).dev).toBeUndefined();
	});
});
