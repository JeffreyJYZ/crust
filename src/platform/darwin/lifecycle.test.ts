/**
 * The macOS lifecycle adapter, proven without AppKit: every event is a bit the
 * fake shim reports, and the settle handshake is one counter. A static check on
 * the C unit proves the delegate actually installs the four selectors and the
 * NSTerminateLater reply, since compiling it here would install a delegate.
 */

import { describe, expect, test } from "bun:test";

import {
	darwinLifecycleSource,
	type LifecycleShim,
	LIFECYCLE_BITS,
	lifecycleEventsFromMask,
} from "@/platform/darwin/lifecycle.ts";
import shimSource from "./shim/95_deeplink.c" with { type: "text" };
import lifecycleUnitSource from "./shim/117_lifecycle.c" with { type: "text" };

function shim(overrides: Partial<LifecycleShim> = {}): LifecycleShim {
	return { take: () => 0, settle: () => 0, ...overrides };
}

describe("lifecycleEventsFromMask", () => {
	test("decodes each bit in order and ignores unknown bits", () => {
		expect(lifecycleEventsFromMask(0)).toEqual([]);
		expect(lifecycleEventsFromMask(LIFECYCLE_BITS.activate)).toEqual(["activate"]);
		expect(lifecycleEventsFromMask(LIFECYCLE_BITS.reopen)).toEqual(["reopen"]);
		expect(
			lifecycleEventsFromMask(
				LIFECYCLE_BITS.activate |
					LIFECYCLE_BITS.beforeQuit |
					LIFECYCLE_BITS.willQuit |
					LIFECYCLE_BITS.reopen,
			),
		).toEqual(["activate", "before-quit", "will-quit", "reopen"]);
		expect(lifecycleEventsFromMask(0x8000)).toEqual([]);
	});
});

describe("darwinLifecycleSource", () => {
	test("take drains the native mask and settle acknowledges a deferred quit", () => {
		let mask = LIFECYCLE_BITS.beforeQuit | LIFECYCLE_BITS.willQuit;
		let settles = 0;
		const source = darwinLifecycleSource(
			shim({
				take: () => mask,
				settle: () => ++settles,
			}),
		);
		expect(source.take()).toEqual(["before-quit", "will-quit"]);
		source.settle?.();
		mask = 0;
		expect(source.take()).toEqual([]);
		expect(settles).toBe(1);
	});
});

describe("the C app delegate", () => {
	test("registers all four lifecycle selectors and the terminate reply", () => {
		const source = `${shimSource}\n${lifecycleUnitSource}`;
		for (const selector of [
			"applicationDidBecomeActive:",
			"applicationShouldTerminate:",
			"applicationWillTerminate:",
			"applicationShouldHandleReopen:hasVisibleWindows:",
			"replyToApplicationShouldTerminate:",
		]) {
			expect(source).toContain(selector);
		}
		expect(source).toContain("NSTerminateLater");
		expect(source).toContain("crust_lifecycle_take");
		expect(source).toContain("crust_lifecycle_settle");
	});
});
