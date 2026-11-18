import { describe, expect, test } from "bun:test";
import { WindowAdapterError } from "@/plugins/window";
import { fakeAdapter } from "./window-adapter-fake.ts";
import { type FakeOptions, openFake } from "./window-fake.ts";

/**
 * The state half: geometry, the three window-manager flags and always-on-top. The flags are read
 * from GDK's state word rather than from what was asked, so each pair below proves the read follows
 * the write — and the Wayland case proves the placement refusal instead of a fabricated origin.
 */
const URL = "http://127.0.0.1:4123/";

async function opened(options: FakeOptions = {}) {
	const { shim, platform } = await openFake(options);
	const native = fakeAdapter(platform, shim.symbols);
	native.create({ label: "main", url: URL });
	return { shim, native };
}

function codeOf(run: () => unknown): string {
	try {
		run();
		return "no-throw";
	} catch (error) {
		return error instanceof WindowAdapterError ? error.code : "untyped";
	}
}

describe("geometry", () => {
	test("setSize resizes the GtkWindow and getSize reads the allocation back", async () => {
		const { native, shim } = await opened();
		native.setSize("main", { width: 900, height: 640 });
		expect(native.getSize("main")).toEqual({ width: 900, height: 640 });
		expect(shim.calls).toContain("resize");
	});

	test("setPosition and getPosition work on an X11 display", async () => {
		const { native, shim } = await opened();
		native.setPosition("main", { x: 120, y: -40 });
		expect(native.getPosition("main")).toEqual({ x: 120, y: -40 });
		expect(shim.calls).toContain("move");
	});

	test("setPosition refuses on a display that cannot place a toplevel", async () => {
		const { native } = await opened({ placeable: false });
		expect(codeOf(() => native.setPosition("main", { x: 0, y: 0 }))).toBe("unknown-adapter");
		expect(() => native.setPosition("main", { x: 0, y: 0 })).toThrow("window.setPosition");
	});

	test("getPosition refuses too, naming itself rather than reporting an origin", async () => {
		const { native } = await opened({ placeable: false });
		expect(codeOf(() => native.getPosition("main"))).toBe("unknown-adapter");
		expect(() => native.getPosition("main")).toThrow("window.getPosition");
	});
});

describe("window-manager flags", () => {
	test("always-on-top is read from the GDK ABOVE bit, not from the request", async () => {
		const { native, shim } = await opened();
		expect(native.isAlwaysOnTop("main")).toBe(false);
		native.setAlwaysOnTop("main", true);
		expect(native.isAlwaysOnTop("main")).toBe(true);
		expect(shim.calls).toContain("keep_above:1");
		native.setAlwaysOnTop("main", false);
		expect(native.isAlwaysOnTop("main")).toBe(false);
	});

	test("fullscreen is read from the GDK FULLSCREEN bit", async () => {
		const { native, shim } = await opened();
		native.setFullscreen("main", true);
		expect(native.isFullscreen("main")).toBe(true);
		expect(shim.calls).toContain("flag:2:1");
		native.setFullscreen("main", false);
		expect(native.isFullscreen("main")).toBe(false);
	});

	test("minimize and unminimize move the ICONIFIED bit, and isMinimized reads it", async () => {
		const { native, shim } = await opened();
		native.minimize("main");
		expect(native.isMinimized("main")).toBe(true);
		expect(shim.calls).toContain("flag:0:1");
		native.unminimize("main");
		expect(native.isMinimized("main")).toBe(false);
		expect(shim.calls).toContain("flag:0:0");
	});

	test("maximize moves the MAXIMIZED bit, and isMaximized reads it", async () => {
		const { native, shim } = await opened();
		native.maximize("main");
		expect(native.isMaximized("main")).toBe(true);
		expect(shim.calls).toContain("flag:1:1");
	});

	test("a flag read before GDK has a GdkWindow refuses instead of answering false", async () => {
		const { native } = await opened({ realised: false });
		expect(codeOf(() => native.isMinimized("main"))).toBe("unknown-adapter");
		expect(() => native.isMaximized("main")).toThrow("window.isMaximized");
	});

	test("an unknown label is refused by every state command", async () => {
		const { native } = await opened();
		expect(codeOf(() => native.getSize("ghost"))).toBe("unknown-window");
		expect(codeOf(() => native.isFullscreen("ghost"))).toBe("unknown-window");
	});
});
