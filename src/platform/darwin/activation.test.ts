import { beforeEach, describe, expect, test } from "bun:test";

import { activateForWindow, type RaiseSends, raiseApp, resetActivation } from "./activation.ts";

/** A fake AppKit that records every selector sent through it. */
function fakeSends(options: { active?: boolean; app?: number } = {}) {
	const sent: string[] = [];
	const sends: RaiseSends = {
		sharedApp: () => options.app ?? 7,
		isActive: () => {
			sent.push("isActive");
			return options.active ?? false;
		},
		activateIgnoringOtherApps: () => {
			sent.push("activateIgnoringOtherApps:");
		},
	};
	return { sent, sends };
}

/** The platform's once-per-process `-activate`, recorded instead of sent. */
function onceSpy() {
	const calls: string[] = [];
	return {
		calls,
		once: () => {
			calls.push("-activate");
		},
	};
}

describe("app.activate", () => {
	beforeEach(() => {
		resetActivation();
	});

	test("always raises on the second window as well as the first", () => {
		const first = fakeSends();
		const firstOnce = onceSpy();
		expect(activateForWindow("always", firstOnce.once, first.sends)).toBe(true);

		const second = fakeSends();
		const secondOnce = onceSpy();
		expect(activateForWindow("always", secondOnce.once, second.sends)).toBe(true);

		expect(first.sent).toEqual(["isActive", "activateIgnoringOtherApps:"]);
		expect(second.sent).toEqual(["isActive", "activateIgnoringOtherApps:"]);
	});

	/**
	 * The measurement this rule exists for, on a built bundle with
	 * `lsappinfo info -only name $(lsappinfo front)`: the first window activated at t1.5, focus was
	 * handed to Ghostty at t3, and a window the page created at t8 pulled the app back in front. A
	 * per-window `isActive` test cannot tell "no window yet" from "the human is elsewhere".
	 */
	test("first raises once per process: two creates, both inactive, one activation", () => {
		const first = fakeSends({ active: false });
		const firstOnce = onceSpy();
		const second = fakeSends({ active: false });
		const secondOnce = onceSpy();

		expect(activateForWindow("first", firstOnce.once, first.sends)).toBe(true);
		expect(activateForWindow("first", secondOnce.once, second.sends)).toBe(false);

		expect(first.sent).toEqual(["isActive", "activateIgnoringOtherApps:"]);
		expect(second.sent).toEqual([]);
		expect(firstOnce.calls).toEqual(["-activate"]);
		expect(secondOnce.calls).toEqual([]);
	});

	test("never sends no selector at all, not even the isActive read", () => {
		const { sends, sent } = fakeSends();
		const spy = onceSpy();
		expect(activateForWindow("never", spy.once, sends)).toBe(false);
		expect(sent).toEqual([]);
		expect(spy.calls).toEqual([]);
	});

	test("an app that is already active is not raised again", () => {
		const { sends, sent } = fakeSends({ active: true });
		raiseApp(sends);
		expect(sent).toEqual(["isActive"]);
	});

	test("a null shared application sends nothing", () => {
		const { sends, sent } = fakeSends({ app: 0 });
		raiseApp(sends);
		expect(sent).toEqual([]);
	});

	test("a selector that throws is swallowed, because activation is cosmetic", () => {
		const sends: RaiseSends = {
			sharedApp: () => 7,
			isActive: () => false,
			activateIgnoringOtherApps: () => {
				throw new Error("no such selector");
			},
		};
		expect(() => raiseApp(sends)).not.toThrow();
	});
});
