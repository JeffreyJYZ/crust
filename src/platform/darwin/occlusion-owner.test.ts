/**
 * The shared owner's invariant, without WebKit: a void setter means only the owner can know whether
 * crust was the one that disabled detection. The first holder turns it off, the last one restores
 * WebKit's default, and nobody in between sends anything.
 */
import { describe, expect, test } from "bun:test";
import { isolatedOcclusionOwner, type OcclusionSender } from "./occlusion.ts";

function recorder(calls: string[], available = true): OcclusionSender {
	return (view, enabled) => {
		calls.push(`${enabled ? "on" : "off"}:${view}`);
		return available;
	};
}

describe("the shared occlusion owner", () => {
	test("the first holder disables and the last release restores the default", () => {
		const owner = isolatedOcclusionOwner();
		const calls: string[] = [];
		const holder = Symbol("first");
		expect(owner.acquire(7, holder, recorder(calls))).toBe(true);
		expect(calls).toEqual(["off:7"]);
		expect(owner.holds(7)).toBe(1);
		owner.release(7, holder);
		expect(calls).toEqual(["off:7", "on:7"]);
		expect(owner.holds(7)).toBe(0);
	});

	test("a second holder sends nothing, so a capture inside a perf run leaves detection off", () => {
		const owner = isolatedOcclusionOwner();
		const perf: string[] = [];
		const capture: string[] = [];
		const perfHolder = Symbol("perf");
		const captureHolder = Symbol("capture");
		expect(owner.acquire(7, perfHolder, recorder(perf))).toBe(true);
		expect(owner.acquire(7, captureHolder, recorder(capture))).toBe(true);
		// Neither the capture's acquire nor its release reaches WebKit: perf still owns the view.
		expect(capture).toEqual([]);
		owner.release(7, captureHolder);
		expect(capture).toEqual([]);
		expect(perf).toEqual(["off:7"]);
		expect(owner.holds(7)).toBe(1);
		owner.release(7, perfHolder);
		expect(perf).toEqual(["off:7", "on:7"]);
	});

	test("re-assert sends disable only while a holder remains", () => {
		const owner = isolatedOcclusionOwner();
		const calls: string[] = [];
		const holder = Symbol("perf");
		owner.acquire(7, holder, recorder(calls));
		owner.reassert(7);
		expect(calls).toEqual(["off:7", "off:7"]);
		owner.release(7, holder);
		owner.reassert(7);
		expect(calls).toEqual(["off:7", "off:7", "on:7"]);
	});

	test("an absent selector records no holder, so nothing is restored later", () => {
		const owner = isolatedOcclusionOwner();
		const calls: string[] = [];
		const holder = Symbol("capture");
		expect(owner.acquire(7, holder, recorder(calls, false))).toBe(false);
		expect(owner.holds(7)).toBe(0);
		owner.release(7, holder);
		expect(calls).toEqual(["off:7"]);
	});

	test("views are independent because the selector is per-webview", () => {
		const owner = isolatedOcclusionOwner();
		const calls: string[] = [];
		const first = Symbol("one");
		const second = Symbol("two");
		owner.acquire(7, first, recorder(calls));
		owner.acquire(9, second, recorder(calls));
		owner.release(7, first);
		expect(calls).toEqual(["off:7", "off:9", "on:7"]);
		expect(owner.holds(9)).toBe(1);
		owner.release(9, second);
		expect(calls).toEqual(["off:7", "off:9", "on:7", "on:9"]);
	});

	test("re-acquiring the same holder is a no-op, the way a per-tick re-assert is", () => {
		const owner = isolatedOcclusionOwner();
		const calls: string[] = [];
		const holder = Symbol("perf");
		expect(owner.acquire(7, holder, recorder(calls))).toBe(true);
		expect(owner.acquire(7, holder, recorder(calls))).toBe(true);
		expect(calls).toEqual(["off:7"]);
		expect(owner.holds(7)).toBe(1);
		owner.release(7, holder);
		expect(owner.holds(7)).toBe(0);
	});
});
