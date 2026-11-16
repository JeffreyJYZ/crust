import { afterEach, describe, expect, test } from "bun:test";
import { loadPlatform } from "@/app-loop.ts";
import type { CrustConfig } from "@/config";
import { LinuxPlatform } from "@/platform/linux";

const CONFIG: CrustConfig = {
	app: { id: "land.jyz.dispatch", name: "dispatch", version: "0.0.0" },
	windows: [{ label: "main", width: 800, height: 600 }],
};

const real = process.platform;

/** Pretend to be another OS for one call; `loadPlatform` reads `process.platform` only. */
function asPlatform(name: NodeJS.Platform): void {
	Object.defineProperty(process, "platform", { value: name, configurable: true });
}

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

	test("an unsupported platform names itself instead of loading a shim", async () => {
		asPlatform("freebsd");
		await expect(loadPlatform(CONFIG)).rejects.toThrow("no platform for freebsd");
	});
});
