import { describe, expect, test } from "bun:test";
import { WEBVIEW2_BOOTSTRAPPER_URL } from "./preflight.ts";
import { fakeBackend } from "./fake-backend.ts";
import { createPlatform } from "./platform.ts";

const CONFIG = { appName: "crust-test" };

describe("start", () => {
	test("probes, compiles, initialises COM and registers the class exactly once", async () => {
		const backend = fakeBackend();
		const platform = createPlatform(CONFIG, backend);
		await platform.start();
		await platform.start();
		expect(platform.started).toBe(true);
		expect(platform.unavailable).toBeUndefined();
		expect(backend.calls.filter((call) => call === "load")).toHaveLength(1);
		expect(backend.calls.filter((call) => call === "com_init")).toHaveLength(1);
		expect(backend.calls.filter((call) => call === "register_class:crust-test")).toHaveLength(
			1,
		);
	});

	/**
	 * A machine without WebView2 is a supported state, not a crash: `start()` resolves so the app
	 * can print the install remedy, and the same text comes out of `createWindow` where a caller
	 * cannot miss it.
	 */
	test("a missing WebView2 runtime resolves and names the bootstrapper", async () => {
		const backend = fakeBackend({ report: { loader: false, coreVersion: undefined } });
		const platform = createPlatform(CONFIG, backend);
		await platform.start();
		const text = platform.unavailable ?? "";
		expect(text).toContain("WebView2Loader.dll");
		expect(text).toContain(WEBVIEW2_BOOTSTRAPPER_URL);
		expect(text).toContain("10.0.22631");
		expect(backend.calls).not.toContain("load");
		expect(() => platform.createWindow({ label: "main" })).toThrow(WEBVIEW2_BOOTSTRAPPER_URL);
	});

	test("a failed COM apartment is reported, not thrown", async () => {
		const platform = createPlatform(CONFIG, fakeBackend({ comInit: -2147417850 }));
		await platform.start();
		expect(platform.unavailable ?? "").toContain("CoInitializeEx");
	});

	test("a class that never registered reports the OS error", async () => {
		const platform = createPlatform(CONFIG, fakeBackend({ classAtom: 0 }));
		await platform.start();
		expect(platform.unavailable ?? "").toContain("RegisterClassExW");
		expect(platform.unavailable ?? "").toContain("87");
	});

	// A shim that will not compile is a defect in crust, not a missing runtime, so it stays loud.
	test("a shim that will not build propagates instead of reporting", async () => {
		const platform = createPlatform(CONFIG, fakeBackend({ loadThrows: true }));
		await expect(platform.start()).rejects.toThrow("cannot build the shim");
	});
});

describe("createWindow", () => {
	test("opens one window with the configured title and size, then tracks it", async () => {
		const backend = fakeBackend();
		const platform = createPlatform(CONFIG, backend);
		await platform.start();
		const handle = platform.createWindow({
			label: "main",
			url: "http://127.0.0.1:4321/",
			width: 900,
			height: 640,
			title: "Crust Test",
		});
		expect(handle).toEqual({ label: "main" });
		expect(backend.calls).toContain("window_new:Crust Test:900x640:crust-test");
		expect(backend.calls).toContain("webview_new:http://127.0.0.1:4321/");
		expect(platform.window("main")).toEqual({ label: "main" });
		expect(platform.nativeWindow("main")).toBe(100);
		expect(platform.windowUrl("main")).toBe("http://127.0.0.1:4321/");
	});

	test("defaults the size and the title to the label", async () => {
		const backend = fakeBackend();
		const platform = createPlatform(CONFIG, backend);
		await platform.start();
		platform.createWindow({ label: "main" });
		expect(backend.calls).toContain("window_new:main:1100x760:crust-test");
	});

	test("a relative URL becomes about:blank, because no browser takes a bare path", async () => {
		const backend = fakeBackend();
		const platform = createPlatform(CONFIG, backend);
		await platform.start();
		platform.createWindow({ label: "main", url: "/notes" });
		expect(backend.calls).toContain("webview_new:about:blank");
		expect(platform.windowUrl("main")).toBe("about:blank");
	});

	/**
	 * A configured window is opened by `start()` in a built app, and the app's own window loop then
	 * asks for the same label: a second native window for one label would give two of everything.
	 */
	test("the same label twice returns one window", async () => {
		const backend = fakeBackend();
		const platform = createPlatform(CONFIG, backend);
		await platform.start();
		const first = platform.createWindow({ label: "main" });
		const second = platform.createWindow({ label: "main" });
		expect(second).toEqual(first);
		expect(backend.hwnds).toHaveLength(1);
	});

	test("a controller that never answers destroys the window and throws", async () => {
		const backend = fakeBackend({ failWebView: true });
		const platform = createPlatform(CONFIG, backend);
		await platform.start();
		expect(() => platform.createWindow({ label: "main" })).toThrow(
			"WebView2 controller failed",
		);
		expect(backend.calls).toContain("window_destroy");
		expect(platform.window("main")).toBeUndefined();
	});

	test("a refused CreateWindowExW throws with the OS error", async () => {
		const platform = createPlatform(CONFIG, fakeBackend({ failWindow: true }));
		await platform.start();
		expect(() => platform.createWindow({ label: "main" })).toThrow("GetLastError 87");
	});

	test("refuses an empty label and a call before start()", () => {
		const platform = createPlatform(CONFIG, fakeBackend());
		expect(() => platform.createWindow({ label: "" })).toThrow("label must not be empty");
		expect(() => platform.createWindow({ label: "main" })).toThrow("start() has not run");
	});

	test("an unknown label is undefined, and a closed window prunes itself", async () => {
		const backend = fakeBackend();
		const platform = createPlatform(CONFIG, backend);
		await platform.start();
		platform.createWindow({ label: "main" });
		expect(platform.window("nope")).toBeUndefined();
		backend.closeWindow(100);
		expect(platform.window("main")).toBeUndefined();
		expect(platform.windowLabels()).toEqual([]);
		expect(platform.nativeWindow("main")).toBeUndefined();
	});
});
