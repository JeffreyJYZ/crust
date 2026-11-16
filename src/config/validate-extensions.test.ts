import { describe, expect, test } from "bun:test";

import { ConfigError, validateConfig } from "./schema.ts";
import { validateExtensions } from "./validate-extensions.ts";
import { Validator } from "./validator.ts";

function issues(value: unknown): string[] {
	const v = new Validator();
	validateExtensions(v, value);
	return v.issues.map((issue) => issue.path);
}

/** The paths `validateConfig` reports, which is the only proof the root key is wired in. */
function rootIssues(extensions: unknown): string[] {
	const config = {
		app: { id: "dev.crust.test", name: "Test", version: "0.1.0" },
		windows: [{ label: "main" }],
		extensions,
	};
	try {
		validateConfig(config);
		return [];
	} catch (error) {
		if (!(error instanceof ConfigError)) throw error;
		return error.issues.map((issue) => issue.path);
	}
}

describe("extensions config", () => {
	test("accepts a project-relative path, a directory-relative path and an absolute one", () => {
		expect(issues(undefined)).toEqual([]);
		expect(issues([])).toEqual([]);
		expect(issues(["clock.ts", "extensions/ping.ts", "/opt/app/extensions/x.ts"])).toEqual([]);
	});

	test("refuses a value that is not an array", () => {
		expect(issues("clock.ts")).toEqual(["extensions"]);
	});

	test("refuses an empty entry", () => {
		expect(issues(["  "])).toEqual(["extensions[0]"]);
	});

	test("refuses a non-string entry", () => {
		expect(issues(["clock.ts", 7])).toEqual(["extensions[1]"]);
	});

	test("refuses a relative path that climbs out of the project", () => {
		expect(issues(["../outside.ts"])).toEqual(["extensions[0]"]);
		expect(issues(["extensions/../../outside.ts"])).toEqual(["extensions[0]"]);
	});

	test("refuses an unknown key on a section-shaped value", () => {
		expect(issues({ files: ["clock.ts"] })).toEqual(["extensions.files"]);
	});
});

describe("extensions in the root config", () => {
	test("is accepted as a root key, so a project can list its files", () => {
		expect(rootIssues(["extensions/clock.ts"])).toEqual([]);
		expect(rootIssues(undefined)).toEqual([]);
	});

	test("its failures arrive through validateConfig, not only the section check", () => {
		expect(rootIssues(["../outside.ts"])).toEqual(["extensions[0]"]);
		expect(rootIssues("clock.ts")).toEqual(["extensions"]);
	});
});
