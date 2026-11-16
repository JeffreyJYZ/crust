import { describe, expect, test } from "bun:test";

import { ConfigError, validateConfig } from "@/config";

const base = {
	app: { id: "dev.crust.updater", name: "Updater", version: "0.0.0" },
	windows: [{ label: "main" }],
};

const pubkey = Buffer.alloc(32, 3).toString("base64");

function withUpdater(updater: unknown): unknown {
	return { ...base, updater };
}

describe("updater config", () => {
	test("accepts an endpoint, a 32-byte pubkey and autoCheck", () => {
		const section = { endpoint: "https://example.test/latest.json", pubkey, autoCheck: true };
		expect(validateConfig(withUpdater(section)).updater).toEqual(section);
	});

	test("accepts allowFileUrl, which is the only way download may fetch a file: url", () => {
		// `UpdaterConfig` in src/config/types.ts is the coordinator's file; the key is validated
		// here and reaches the plugin through the whole section, so the cast asserts the value.
		const parsed = validateConfig(withUpdater({ allowFileUrl: true })).updater as {
			allowFileUrl?: boolean;
		};
		expect(parsed).toEqual({ allowFileUrl: true });
	});

	test("an empty section is valid, and registers the plugin with no defaults", () => {
		expect(validateConfig(withUpdater({})).updater).toEqual({});
	});

	test("refuses a pubkey that does not decode to 32 raw bytes", () => {
		for (const bad of [Buffer.alloc(31, 1).toString("base64"), "not base64!", 7]) {
			expect(() => validateConfig(withUpdater({ pubkey: bad }))).toThrow(/updater\.pubkey/);
		}
	});

	test("refuses an endpoint that is not a non-empty string", () => {
		expect(() => validateConfig(withUpdater({ endpoint: "" }))).toThrow(/updater\.endpoint/);
	});

	test("refuses an autoCheck that is not a boolean", () => {
		expect(() => validateConfig(withUpdater({ autoCheck: "yes" }))).toThrow(
			/updater\.autoCheck/,
		);
	});

	test("refuses an allowFileUrl that is not a boolean", () => {
		expect(() => validateConfig(withUpdater({ allowFileUrl: "yes" }))).toThrow(
			/updater\.allowFileUrl/,
		);
	});

	test("refuses an unknown key, like every other section", () => {
		expect(() => validateConfig(withUpdater({ nope: true }))).toThrow(ConfigError);
	});
});
