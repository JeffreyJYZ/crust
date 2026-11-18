import { describe, expect, test } from "bun:test";
import { WindowAdapterError } from "@/plugins/window";
import { fakeAdapter } from "./window-adapter-fake.ts";
import { type FakeOptions, openFake } from "./window-fake.ts";

/**
 * The chrome half: the title bar and the opacity are written and read back, and the pointer pair
 * refuses by name because GTK3 has no process-wide cursor. The read-backs are the point: a GTK that
 * accepted the call and ignored it must surface as an error, not as the value that was asked for.
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

describe("decorations", () => {
	test("setDecorations applies and isDecorated reads the applied value back", async () => {
		const { native, shim } = await opened();
		native.setDecorations("main", false);
		expect(native.isDecorated("main")).toBe(false);
		expect(shim.calls).toContain("set_decorated:0");
		native.setDecorations("main", true);
		expect(native.isDecorated("main")).toBe(true);
	});

	test("a GTK that accepted the flag and ignored it is handler-error", async () => {
		const { native, shim } = await opened();
		native.setDecorations("main", true);
		shim.ignoring.add("set_decorated");
		// The read-back still says true, so reporting "decorations off" would be the lie.
		expect(codeOf(() => native.setDecorations("main", false))).toBe("handler-error");
	});

	test("an unknown label is refused before GTK is touched", async () => {
		const { native, shim } = await opened();
		shim.calls.length = 0;
		expect(codeOf(() => native.setDecorations("ghost", false))).toBe("unknown-window");
		expect(shim.calls).toEqual([]);
	});
});

describe("opacity", () => {
	test("setOpacity applies and opacity reads the applied value back", async () => {
		const { native, shim } = await opened();
		native.setOpacity("main", 0.5);
		expect(native.opacity("main")).toBe(0.5);
		expect(shim.calls).toContain("set_opacity:0.5");
	});

	test("a GTK that accepted the alpha and ignored it is handler-error", async () => {
		const { native, shim } = await opened();
		shim.ignoring.add("set_opacity");
		expect(codeOf(() => native.setOpacity("main", 0.25))).toBe("handler-error");
	});
});

describe("the pointer pair", () => {
	test("setCursor refuses by name: GTK3 has no process-wide cursor", async () => {
		const { native } = await opened();
		expect(codeOf(() => native.setCursor?.("pointer"))).toBe("unknown-adapter");
		expect(() => native.setCursor?.("pointer")).toThrow("window.setCursor");
		expect(() => native.setCursor?.("pointer")).toThrow("GdkWindow");
	});

	test("setCursorVisible refuses by name: there is no +[NSCursor hide] equivalent", async () => {
		const { native } = await opened();
		expect(codeOf(() => native.setCursorVisible?.(false))).toBe("unknown-adapter");
		expect(() => native.setCursorVisible?.(false)).toThrow("window.setCursorVisible");
		expect(() => native.setCursorVisible?.(false)).toThrow("NSCursor");
	});

	test("the refusal is a WindowAdapterError, so the bridge sees unknown-adapter not handler-error", async () => {
		const { native } = await opened();
		try {
			native.setCursor?.("text");
			throw new Error("expected a refusal");
		} catch (error) {
			expect(error).toBeInstanceOf(WindowAdapterError);
			expect((error as WindowAdapterError).code).toBe("unknown-adapter");
		}
	});
});
