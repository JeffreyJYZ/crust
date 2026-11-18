import { basename } from "node:path";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { loadPlatform } from "@/app-loop.ts";
import type { CrustConfig } from "@/config";
import { LinuxPlatform } from "@/platform/linux";
import type { WindowsPlatformConfig } from "@/platform/windows";
import { WindowsPlatform } from "@/platform/windows/platform.ts";

const CONFIG: CrustConfig = {
	app: { id: "land.jyz.dispatch", name: "dispatch", version: "0.0.0" },
	windows: [{ label: "main", width: 800, height: 600 }],
};

const real = process.platform;

/** Pretend to be another OS for one call; `loadPlatform` reads `process.platform` only. */
function asPlatform(name: NodeJS.Platform): void {
	Object.defineProperty(process, "platform", { value: name, configurable: true });
}

/**
 * `WindowsPlatform` keeps `userDataDir` in a private field, so the only way to see what
 * `loadPlatform` hands it is to intercept `createPlatform`. The real class is still returned,
 * so the dispatch-by-constructor test keeps its meaning.
 */
const windowsConfigs: WindowsPlatformConfig[] = [];
mock.module("@/platform/windows", () => ({
	WindowsPlatform,
	createPlatform: (config: WindowsPlatformConfig) => {
		windowsConfigs.push(config);
		return new WindowsPlatform(config);
	},
}));

afterEach(() => {
	asPlatform(real);
});

describe("loadPlatform dispatch", () => {
	test("darwin selects the AppKit platform", async () => {
		asPlatform("darwin");
		const platform = await loadPlatform(CONFIG);
		expect(platform.constructor.name).toBe("DarwinPlatform");
	});

	/**
	 * Constructing the Linux platform is safe on any host: nothing loads GTK until
	 * `start()`, so this proves the arm exists and forwards the config without
	 * calling a native symbol.
	 */
	test("linux selects the GTK platform and forwards the whole config", async () => {
		asPlatform("linux");
		const platform = await loadPlatform(CONFIG);
		expect(platform).toBeInstanceOf(LinuxPlatform);
		// The config reached it: a window from `CONFIG` is what the platform was told
		// to expect, and a label it never saw is still refused the same way.
		expect(() => platform.createWindow({ label: "" })).toThrow("label must not be empty");
	});

	test("win32 selects the WebView2 platform, named after the app", async () => {
		asPlatform("win32");
		const platform = await loadPlatform(CONFIG);
		expect(platform.constructor.name).toBe("WindowsPlatform");
	});

	/**
	 * The profile folder must be per-app: two crust apps built under one executable name
	 * would otherwise share one WebView2 profile and each other's cookies and state.
	 */
	test("win32 derives a per-app userDataDir from the app id", async () => {
		const override = process.env.CRUST_DATA_DIR;
		delete process.env.CRUST_DATA_DIR;
		try {
			const first = { ...CONFIG, app: { ...CONFIG.app, id: "land.jyz.first" } };
			const second = { ...CONFIG, app: { ...CONFIG.app, id: "land.jyz.second" } };
			windowsConfigs.length = 0;
			asPlatform("win32");
			await loadPlatform(first);
			await loadPlatform(second);
			expect(windowsConfigs).toHaveLength(2);
			// `?? ""` keeps a missing field visible as a failure, not a type error.
			const firstDir = windowsConfigs[0]?.userDataDir ?? "";
			const secondDir = windowsConfigs[1]?.userDataDir ?? "";
			expect(firstDir).not.toBe("");
			expect(secondDir).not.toBe("");
			expect(firstDir).not.toBe(secondDir);
			// The last path segment is the id, so no two apps land on one profile.
			expect(basename(firstDir)).toBe(first.app.id);
			expect(basename(secondDir)).toBe(second.app.id);
		} finally {
			if (override === undefined) delete process.env.CRUST_DATA_DIR;
			else process.env.CRUST_DATA_DIR = override;
		}
	});

	test("an unsupported platform names itself instead of loading a shim", async () => {
		asPlatform("freebsd");
		await expect(loadPlatform(CONFIG)).rejects.toThrow("no platform for freebsd");
	});
});
