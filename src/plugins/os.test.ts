/**
 * `crust:os` proofs. The plugin tests inject a fake adapter and never touch AppKit; the darwin section reads the real system, which is safe — `uname`, `hostname`, `NSProcessInfo`, `NSLocale` and `NSBundle` answer without a window, without a permission prompt and without taking focus.
 * The oracle for the version is `sw_vers -productVersion`: if the C parse drifted, that comparison is what says so.
 */

import { describe, expect, test } from "bun:test";
import { hostname } from "node:os";
import { isNotImplemented } from "@/plugins/define.ts";
import { createOsPlugin, type OsAdapter, osPlugin } from "@/plugins/os.ts";
import { darwinOsAdapter } from "@/platform/darwin/os-info.ts";
import { openerUnitStatus } from "@/platform/darwin/opener.ts";

const notDarwin = process.platform !== "darwin";

/** A fake adapter with the three reads, so the plugin's own composition can be seen. */
function fake(overrides: Partial<OsAdapter> = {}): OsAdapter {
	return {
		systemVersion: () => "27.0.1",
		locale: () => "en-GB",
		appVersion: () => "1.2.3",
		...overrides,
	};
}

describe("os plugin", () => {
	test("not-implemented without an adapter, naming NSProcessInfo", async () => {
		const plugin = createOsPlugin();
		for (const result of [await plugin.commands.info(), await plugin.commands.locale()]) {
			expect(isNotImplemented(result)).toBe(true);
			if (isNotImplemented(result)) expect(result.requires).toBe("NSProcessInfo");
		}
	});

	test("the default registration is the adapter-less one", () => {
		expect(osPlugin.name).toBe("os");
		expect(typeof osPlugin.commands.info).toBe("function");
	});

	test("info reports the machine Bun reads and the facts the adapter supplies", async () => {
		const result = await createOsPlugin(fake()).commands.info();
		expect(result).toEqual({
			ok: true,
			platform: process.platform,
			arch: process.arch,
			hostname: hostname(),
			version: "27.0.1",
			appVersion: "1.2.3",
		});
	});

	test("a process with no bundle reports appVersion null, not an empty string", async () => {
		const result = await createOsPlugin(fake({ appVersion: () => null })).commands.info();
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.appVersion).toBeNull();
	});

	test("locale answers the identifier the adapter resolved", async () => {
		expect(await createOsPlugin(fake()).commands.locale()).toEqual({
			ok: true,
			locale: "en-GB",
		});
	});

	test("an adapter that throws is a typed failure, never a rejected invoke", async () => {
		const plugin = createOsPlugin(
			fake({
				systemVersion: () => {
					throw new Error("NSProcessInfo did not report an operating system version");
				},
				locale: () => {
					throw new Error("no locale");
				},
			}),
		);
		expect(await plugin.commands.info()).toEqual({
			ok: false,
			code: "handler-error",
			message: "os.info: NSProcessInfo did not report an operating system version",
		});
		expect(await plugin.commands.locale()).toEqual({
			ok: false,
			code: "handler-error",
			message: "os.locale: no locale",
		});
	});

	test("an async adapter is awaited", async () => {
		const adapter: OsAdapter = {
			systemVersion: async () => "27.0.1",
			locale: async () => "en-GB",
			appVersion: async () => null,
		};
		const result = await createOsPlugin(adapter).commands.info();
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.version).toBe("27.0.1");
	});
});

describe("darwin system information", () => {
	/** `cc()` refusing a symbol it cannot find is what makes a successful compile the proof. */
	test.skipIf(notDarwin)("the C unit compiles and exports its seven symbols", () => {
		expect(openerUnitStatus()).toEqual({ available: true, reason: "compiled" });
	});

	test.skipIf(notDarwin)("the version matches what sw_vers reports", () => {
		const reported = darwinOsAdapter().systemVersion();
		expect(reported).toMatch(/^\d+\.\d+\.\d+$/);
		const swVers = Bun.spawnSync(["sw_vers", "-productVersion"]).stdout.toString().trim();
		expect(reported).toBe(swVers);
	});

	test.skipIf(notDarwin)("the locale is a language identifier, not empty", () => {
		expect(darwinOsAdapter().locale()).toMatch(/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/);
	});

	/** `bun test` is an unbundled process, so `CFBundleShortVersionString` is absent by design. */
	test.skipIf(notDarwin)("an unbundled process reports no app version", () => {
		expect(darwinOsAdapter().appVersion()).toBeNull();
	});

	test.skipIf(notDarwin)("info answers the real machine through the darwin adapter", async () => {
		const result = await createOsPlugin(darwinOsAdapter()).commands.info();
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.platform).toBe("darwin");
		expect(["arm64", "x64"]).toContain(result.arch);
		expect(result.hostname.length).toBeGreaterThan(0);
		expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
	});
});
