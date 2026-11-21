/** hunt-21 config trust: every path key stays inside the project or the app data root. */

import { describe, expect, test } from "bun:test";

import { ConfigError, validateConfig } from "@/config";

const base = {
	app: { id: "dev.crust.hunt21", name: "Hunt21", version: "0.0.0" },
	windows: [{ label: "main" }],
};

function issue(config: unknown, key: string): string | undefined {
	try {
		validateConfig(config);
		return undefined;
	} catch (error) {
		expect(error).toBeInstanceOf(ConfigError);
		return (error as ConfigError).issues.find((item) => item.path === key)?.expected;
	}
}

describe("config path containment", () => {
	test("logging.dir refuses a climb and a Windows absolute, not only a leading slash", () => {
		for (const dir of ["../../etc", "logs/../../../etc", "C:\\logs", "\\\\server\\share"]) {
			expect(issue({ ...base, logging: { dir } }, "logging.dir")).toBeDefined();
		}
		expect(issue({ ...base, logging: { dir: "logs" } }, "logging.dir")).toBeUndefined();
	});

	test("build.assets refuses an absolute or climbing path", () => {
		for (const assets of ["/etc", "../../etc", "C:\\etc"]) {
			expect(issue({ ...base, build: { assets } }, "build.assets")).toBeDefined();
		}
		expect(issue({ ...base, build: { assets: "public" } }, "build.assets")).toBeUndefined();
	});

	test("app.icon refuses an absolute or climbing path", () => {
		for (const icon of ["/etc/passwd", "../secret.png"]) {
			expect(issue({ ...base, app: { ...base.app, icon } }, "app.icon")).toBeDefined();
		}
		expect(
			issue({ ...base, app: { ...base.app, icon: "assets/icon.png" } }, "app.icon"),
		).toBeUndefined();
	});
});

describe("config validation gaps", () => {
	test("a duplicate window label is refused by index before startup", () => {
		const found = issue(
			{ ...base, windows: [{ label: "main" }, { label: "main" }] },
			"windows[1].label",
		);
		expect(found).toContain("no other window uses");
	});

	test("a blank plugins entry is refused with its index", () => {
		expect(issue({ ...base, plugins: ["app", ""] }, "config.plugins[1]")).toBeDefined();
	});

	test("browser.origins refuses credentials that originOf would discard", () => {
		for (const origin of ["https://u:p@example.com", "http://user@example.com"]) {
			expect(
				issue({ ...base, browser: { origins: [origin] } }, "browser.origins[0]"),
			).toBeDefined();
		}
		expect(
			issue({ ...base, browser: { origins: ["https://example.com"] } }, "browser.origins[0]"),
		).toBeUndefined();
	});

	test("a non-canonical pubkey is refused at config time", () => {
		const unpadded = Buffer.alloc(32, 3).toString("base64").replace(/=+$/, "");
		expect(issue({ ...base, updater: { pubkey: unpadded } }, "updater.pubkey")).toBeDefined();
		const canonical = Buffer.alloc(32, 3).toString("base64");
		expect(
			issue({ ...base, updater: { pubkey: canonical } }, "updater.pubkey"),
		).toBeUndefined();
	});
});
