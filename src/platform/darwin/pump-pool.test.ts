/**
 * The shim's units document that their +0 Cocoa objects are left to "the pool the pump drains",
 * but the pump never created one, so autoreleased NSDate/NSEvent/NSString/NSValue objects lived for
 * the whole process. This pins that the pool is created before the first send and drained on every
 * return path, and that the declarations exist for the compiler and the runtime alike.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (file: string): string => readFileSync(join(import.meta.dir, file), "utf8");

describe("the darwin pump's autorelease pool", () => {
	test("a pool is created at entry and drained after the tick, on every path", () => {
		const source = read("shim/50_app.c");
		const pump = source.slice(source.indexOf("int shim_pump("));
		const created = pump.indexOf("shim_pool_new()");
		const drained = pump.lastIndexOf("shim_pool_drain(pool)");
		const returned = pump.lastIndexOf("return result;");
		expect(created).toBeGreaterThan(-1);
		expect(pump.indexOf("shim_pool_init(pool)")).toBeGreaterThan(created);
		expect(drained).toBeGreaterThan(created);
		expect(returned).toBeGreaterThan(drained);
		// One exit: an early return between creation and drain would leak the whole tick.
		expect(pump.slice(created, drained)).not.toMatch(/\breturn\b/);
	});

	test("an empty queue does not wait on an NSDate deadline", () => {
		const pump = read("shim/50_app.c").split("int shim_pump(")[1] ?? "";
		// A nil date makes nextEventMatchingMask: return at once; the 4 ms deadline held the JS
		// thread 6.84 ms per tick in the measured baseline, for only 1.7% process CPU.
		expect(pump).not.toContain('sel_registerName("dateByAddingTimeInterval:")');
		expect(pump).toContain("nextEventMatchingMask:untilDate:inMode:dequeue:\"), ~0UL, 0, mode, 1");
		expect(pump).toContain("CFRunLoopRunInMode(mode, 0.00025, 0)");
	});

	test("occluded windows stop the tick and report -1", () => {
		const source = read("shim/50_app.c");
		const pump = source.split("int shim_pump(")[1] ?? "";
		expect(source).toContain('sel_registerName("occlusionState")');
		expect(source).toContain("state & 2LL");
		expect(source).toContain("SHIM_STARTUP_TICKS");
		expect(pump).toContain("!shim_any_window_painting(app)");
		expect(pump).toContain("result = -1;");
	});

	test("the three pool exports are bound on the TS side", () => {
		const index = read("index.ts");
		for (const symbol of ["shim_pool_new", "shim_pool_init", "shim_pool_drain"]) {
			expect(index).toContain(`${symbol}:`);
		}
	});
});
