/**
 * `crust:os` proofs. The plugin tests inject a fake adapter and never touch AppKit; the darwin section reads the real system, which is safe — `uname`, `hostname`, `NSProcessInfo`, `NSLocale` and `NSBundle` answer without a window, without a permission prompt and without taking focus.
 * The oracle for the version is `sw_vers -productVersion`: if the C parse drifted, that comparison is what says so.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { isNotImplemented } from "@/plugins/define.ts";
import {
	createOsPlugin,
	exeExtension,
	type OsAdapter,
	osFamily,
	osPlugin,
} from "@/plugins/os.ts";
import { darwinOsAdapter } from "@/platform/darwin/os-info.ts";
import { openerUnitStatus } from "@/platform/darwin/opener.ts";

const notDarwin = process.platform !== "darwin";

/** A fake adapter with the four reads, so the plugin's own composition can be seen. */
function fake(overrides: Partial<OsAdapter> = {}): OsAdapter {
	return {
		systemVersion: () => "27.0.1",
		locale: () => "en-GB",
		appVersion: () => "1.2.3",
		uptime: () => 3600,
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
			family: osFamily(process.platform),
			exeExtension: exeExtension(process.platform),
			hostname: hostname(),
			version: "27.0.1",
			appVersion: "1.2.3",
			uptime: 3600,
		});
	});

	test("family and exeExtension name the platform the way Tauri does", () => {
		expect(osFamily("darwin")).toBe("macOS");
		expect(osFamily("win32")).toBe("Windows_NT");
		expect(osFamily("linux")).toBe("Linux");
		expect(exeExtension("darwin")).toBe("");
		expect(exeExtension("linux")).toBe("");
		expect(exeExtension("win32")).toBe(".exe");
	});

	test("paths answers the four directories logging writes under", async () => {
		const root = await mkdtemp(join(tmpdir(), "crust-os-"));
		try {
			const paths = createOsPlugin(fake({ root })).commands.paths();
			expect(paths.appData).toBe(root);
			expect(paths.appLog).toBe(join(root, "logs"));
			expect(paths.home.length).toBeGreaterThan(0);
			expect(paths.temp).toBe(tmpdir());
			// No native half is needed for directories, so the adapter-less registration answers too.
			const bare = createOsPlugin().commands.paths();
			expect(bare.appData.endsWith(join("Application Support", "crust"))).toBe(true);
			expect(bare.appLog).toBe(join(bare.appData, "logs"));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
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
			uptime: async () => 120,
		};
		const result = await createOsPlugin(adapter).commands.info();
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.version).toBe("27.0.1");
	});
});

describe("darwin system information", () => {
	/** `cc()` refusing a symbol it cannot find is what makes a successful compile the proof. */
	test.skipIf(notDarwin)("the C unit compiles and exports its eight symbols", () => {
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

	/**
	 * `-systemUptime` counts awake time, so it is positive and never longer than wall-clock time
	 * since boot; the gap between them is how long the machine slept (measured ~30 h here).
	 */
	test.skipIf(notDarwin)("uptime is positive and no longer than wall-clock time since boot", () => {
		const seconds = darwinOsAdapter().uptime();
		expect(Number.isFinite(seconds)).toBe(true);
		expect(seconds).toBeGreaterThan(0);
		const boot = Bun.spawnSync(["sysctl", "-n", "kern.boottime"]).stdout.toString();
		const at = Number(boot.match(/sec = (\d+)/)?.[1] ?? 0);
		expect(at).toBeGreaterThan(0);
		expect(seconds).toBeLessThanOrEqual(Date.now() / 1000 - at + 1);
	});

	test.skipIf(notDarwin)("info answers the real machine through the darwin adapter", async () => {
		const result = await createOsPlugin(darwinOsAdapter()).commands.info();
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.platform).toBe("darwin");
		expect(result.family).toBe("macOS");
		expect(result.exeExtension).toBe("");
		expect(["arm64", "x64"]).toContain(result.arch);
		expect(result.hostname.length).toBeGreaterThan(0);
		expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
		expect(result.uptime).toBeGreaterThan(0);
	});
});
