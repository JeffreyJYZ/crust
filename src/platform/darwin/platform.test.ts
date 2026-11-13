import { describe, expect, test } from "bun:test";
import { ptr } from "bun:ffi";
import { DarwinPlatform, PREFLIGHT, preflightError, shim } from "@/platform/darwin/index.ts";

const SHIM_C = `${import.meta.dir}/shim.c`;

describe("darwin shim", () => {
	test("compiles through cc() and links AppKit", () => {
		const compiled = shim();
		expect(typeof compiled.symbols.shim_window_new).toBe("function");
		expect(typeof compiled.symbols.shim_pump).toBe("function");

		// A C call round-trips: shim_cstr_len is a plain strlen. A JS string
		// cannot cross, so the buffer's address is passed; i64 returns BigInt.
		const bytes = new TextEncoder().encode("crust\0");
		expect(Number(compiled.symbols.shim_cstr_len(ptr(bytes)))).toBe(5);
	});
});

describe("selector preflight", () => {
	test("every listed selector resolves on this system", () => {
		const failures = PREFLIGHT.map((entry) => preflightError(entry)).filter(
			(error): error is string => error !== undefined,
		);
		expect(failures).toEqual([]);
	});

	test("class_getClassMethod is never used as an existence test", async () => {
		// The ban is structural: no JS-visible symbol reaches it at all, and the C
		// file does not declare it.
		expect(shim().symbols).not.toHaveProperty("shim_class_method");
		expect(shim().symbols).not.toHaveProperty("shim_class_getClassMethod");

		const c = await Bun.file(SHIM_C).text();
		expect(c).not.toContain("class_getClassMethod");
		expect(c).not.toContain("class_getClassMethod(");
		// The intern table and the crash-prone constructor stay deleted: no symbol
		// and no selector literal for either survives in the shim source.
		expect(c).not.toContain('"stringWithUTF8String:');
		expect(c).not.toMatch(/shim_intern_[a-z]+/);
		expect(shim().symbols).not.toHaveProperty("shim_intern_bytes");
	});
});

describe("pump timer", () => {
	test("starts, ticks, and stops without leaving a timer", async () => {
		const platform = new DarwinPlatform();
		platform.pump(16);
		expect(platform.pumping).toBe(true);
		expect(platform.ticks).toBeGreaterThan(0);

		await Bun.sleep(60);
		expect(platform.ticks).toBeGreaterThan(1);

		platform.stopPump();
		expect(platform.pumping).toBe(false);
		const stoppedAt = platform.ticks;

		// If the chain re-armed itself the counter would keep climbing.
		await Bun.sleep(60);
		expect(platform.ticks).toBe(stoppedAt);
	});

	test("refuses a non-positive interval", () => {
		const platform = new DarwinPlatform();
		expect(() => platform.pump(0)).toThrow();
		expect(() => platform.pump(-1)).toThrow();
	});
});
