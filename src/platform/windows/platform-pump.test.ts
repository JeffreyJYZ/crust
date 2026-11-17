import { describe, expect, test } from "bun:test";
import { fakeBackend } from "./fake-backend.ts";
import { fakeShim } from "./fake-shim.ts";
import { createPlatform } from "./platform.ts";

const CONFIG = { appName: "crust-test" };

describe("pump", () => {
	test("ticks on the interval the caller gave, and stops leaving no timer", async () => {
		const backend = fakeBackend();
		const platform = createPlatform(CONFIG, backend);
		await platform.start();
		platform.pump(16);
		expect(platform.pumping).toBe(true);
		expect(platform.ticks).toBeGreaterThan(0);

		await Bun.sleep(60);
		expect(platform.ticks).toBeGreaterThan(1);
		expect(backend.calls.filter((call) => call === "pump")).toHaveLength(platform.ticks);

		platform.stopPump();
		expect(platform.pumping).toBe(false);
		const stoppedAt = platform.ticks;
		// If the chain re-armed itself the counter would keep climbing.
		await Bun.sleep(60);
		expect(platform.ticks).toBe(stoppedAt);
	});

	test("a second pump replaces the first instead of running two chains", async () => {
		const platform = createPlatform(CONFIG, fakeBackend());
		await platform.start();
		platform.pump(20);
		platform.pump(20);
		await Bun.sleep(50);
		const first = platform.ticks;
		await Bun.sleep(50);
		// Two chains on one counter would roughly double the growth of a single 20 ms timer.
		expect(platform.ticks - first).toBeLessThanOrEqual(4);
		platform.stopPump();
	});

	test("refuses a non-positive interval", () => {
		const platform = createPlatform(CONFIG, fakeBackend());
		expect(() => platform.pump(0)).toThrow();
		expect(() => platform.pump(-1)).toThrow();
		expect(() => platform.pump(Number.NaN)).toThrow();
	});

	// The real-pump proof must not come from the JS timer: a shim whose PeekMessageW
	// drains nothing leaves nativeMessages at zero while ticks keeps climbing.
	test("nativeMessages moves only when the shim reports a dispatch", async () => {
		let attempts = 0;
		const backend = fakeBackend();
		backend.load = () => ({
			...fakeShim(),
			shim_pump: () => (attempts++ >= 2 ? 3 : 0),
		});
		const platform = createPlatform(CONFIG, backend);
		await platform.start();
		platform.pump(5);
		expect(platform.nativeMessages).toBe(0);
		await Bun.sleep(40);
		platform.stopPump();
		expect(attempts).toBeGreaterThan(2);
		expect(platform.nativeMessages).toBe((attempts - 2) * 3);
	});

	// A pump before start() has no queue to drain, but the cadence still belongs to Bun's timer.
	test("ticks with no shim and reaches nothing", async () => {
		const backend = fakeBackend();
		const platform = createPlatform(CONFIG, backend);
		platform.pump(10);
		await Bun.sleep(40);
		expect(platform.ticks).toBeGreaterThan(1);
		expect(backend.calls).not.toContain("pump");
		platform.stopPump();
	});
});

describe("quit", () => {
	test("tears every window down once and exits once, however often it is called", async () => {
		const backend = fakeBackend();
		const platform = createPlatform(CONFIG, backend);
		await platform.start();
		platform.createWindow({ label: "main" });
		platform.createWindow({ label: "about" });
		platform.pump(16);
		platform.quit();
		platform.quit();

		expect(backend.exits).toEqual([0]);
		expect(backend.calls.filter((call) => call === "webview_close")).toHaveLength(2);
		expect(backend.calls.filter((call) => call === "window_destroy")).toHaveLength(2);
		expect(backend.calls.filter((call) => call === "post_quit")).toHaveLength(1);
		expect(platform.pumping).toBe(false);
		expect(platform.windowLabels()).toEqual([]);
	});

	// A window the human already closed must not be closed twice: Win32 reuses a freed handle.
	test("skips a window that is already gone", async () => {
		const backend = fakeBackend();
		const platform = createPlatform(CONFIG, backend);
		await platform.start();
		platform.createWindow({ label: "main" });
		backend.closeWindow(100);
		platform.quit();
		expect(backend.calls.filter((call) => call === "webview_close")).toHaveLength(0);
		expect(backend.calls.filter((call) => call === "window_destroy")).toHaveLength(0);
	});

	test("quits cleanly when start() found no usable machine", async () => {
		const backend = fakeBackend({ report: { loader: false } });
		const platform = createPlatform(CONFIG, backend);
		await platform.start();
		platform.quit();
		expect(backend.exits).toEqual([0]);
		expect(backend.calls).not.toContain("post_quit");
	});
});
