import { describe, expect, test } from "bun:test";
import { type LinuxBackend, LinuxPlatform } from "./index.ts";

/** A backend that records every call and keeps its own open-window set. */
function fakeBackend(overrides: Partial<LinuxBackend> = {}) {
	const calls = { load: 0, iterate: 0, quit: 0, urls: [] as string[] };
	const open = new Set<bigint>();
	let next = 100n;
	const backend: LinuxBackend = {
		load() {
			calls.load++;
		},
		iterate() {
			calls.iterate++;
		},
		createWindow(_options, url) {
			calls.urls.push(url);
			const win = next++;
			open.add(win);
			return { win, web: win + 1000n, url };
		},
		isOpen(win) {
			return open.has(win);
		},
		destroy(win) {
			open.delete(win);
		},
		quit() {
			calls.quit++;
		},
		...overrides,
	};
	return { backend, calls, close: (win: bigint) => open.delete(win) };
}

describe("start", () => {
	test("loads the runtime once and registers no URI scheme", async () => {
		const { backend, calls } = fakeBackend();
		const platform = new LinuxPlatform(backend);
		await platform.start();
		await platform.start();
		expect(calls.load).toBe(1);
	});

	test("a missing library rejects with the preflight text and stays retryable", async () => {
		const missing = "libgtk-3.so.0 not loadable (gtk_init_check unresolved)";
		const { backend, calls } = fakeBackend({
			load() {
				calls.load++;
				throw new Error(missing);
			},
		});
		const platform = new LinuxPlatform(backend);
		await expect(platform.start()).rejects.toThrow("libgtk-3.so.0 not loadable");
		// Nothing was created, and a second attempt re-runs the load rather than
		// reporting a started platform that has no GTK behind it.
		expect(calls.urls).toHaveLength(0);
		await expect(platform.start()).rejects.toThrow(missing);
		expect(calls.load).toBe(2);
	});
});

describe("createWindow and window", () => {
	test("tracks a window and finds it by label", () => {
		const { backend } = fakeBackend();
		const platform = new LinuxPlatform(backend);
		const handle = platform.createWindow({ label: "main", url: "http://127.0.0.1:1234/" });
		expect(handle).toEqual({ label: "main" });
		expect(platform.window("main")).toEqual({ label: "main" });
	});

	test("returns undefined for an unknown label", () => {
		const { backend } = fakeBackend();
		const platform = new LinuxPlatform(backend);
		expect(platform.window("nope")).toBeUndefined();
	});

	test("prunes a window once GTK no longer holds it", () => {
		const { backend, close } = fakeBackend();
		const platform = new LinuxPlatform(backend);
		platform.createWindow({ label: "main", url: "http://127.0.0.1:1234/" });
		close(100n);
		expect(platform.window("main")).toBeUndefined();
		// Pruned means gone: the next lookup has nothing left to re-test.
		expect(platform.window("main")).toBeUndefined();
	});

	test("refuses an empty label and a duplicate one", () => {
		const { backend } = fakeBackend();
		const platform = new LinuxPlatform(backend);
		expect(() => platform.createWindow({ label: "" })).toThrow("label must not be empty");
		platform.createWindow({ label: "main", url: "http://127.0.0.1:1234/" });
		expect(() => platform.createWindow({ label: "main" })).toThrow("already exists");
	});

	test("passes an absolute URL through and turns a relative one into about:blank", () => {
		const { backend, calls } = fakeBackend();
		const platform = new LinuxPlatform(backend);
		platform.createWindow({ label: "one", url: "http://127.0.0.1:9/app" });
		platform.createWindow({ label: "two", url: "/settings" });
		platform.createWindow({ label: "three" });
		expect(calls.urls).toEqual(["http://127.0.0.1:9/app", "about:blank", "about:blank"]);
	});
});

describe("pump", () => {
	test("iterates the backend on the interval it was given", async () => {
		const { backend, calls } = fakeBackend();
		const platform = new LinuxPlatform(backend);
		platform.pump(5);
		expect(platform.pumping).toBe(true);
		expect(platform.ticks).toBe(1);

		await Bun.sleep(40);
		expect(platform.ticks).toBeGreaterThan(2);
		expect(calls.iterate).toBe(platform.ticks);

		platform.stopPump();
		expect(platform.pumping).toBe(false);
		const stoppedAt = platform.ticks;
		await Bun.sleep(30);
		expect(platform.ticks).toBe(stoppedAt);
	});

	test("refuses a non-positive interval", () => {
		const { backend } = fakeBackend();
		const platform = new LinuxPlatform(backend);
		expect(() => platform.pump(0)).toThrow();
		expect(() => platform.pump(-1)).toThrow();
		expect(() => platform.pump(Number.NaN)).toThrow();
	});
});

describe("quit", () => {
	test("stops the pump and ends the process exactly once", () => {
		const { backend, calls } = fakeBackend();
		const platform = new LinuxPlatform(backend);
		platform.pump(5);
		platform.quit();
		platform.quit();
		expect(calls.quit).toBe(1);
		expect(platform.pumping).toBe(false);
	});
});
