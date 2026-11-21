/**
 * `window.create`'s `activate: false`, proved the way the decision is made: through recording
 * doubles instead of an `NSWindow`. The property that matters is negative — a passive create never
 * sends the selector that steals the front — so the assertion is on an empty recording, which a
 * test that merely restated a constant could not see.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import {
	activateForWindow,
	appkitRaiseSends,
	type RaiseSends,
	resetActivation,
} from "./activation.ts";
import { createActivation, raiseWindow, type WindowOrderSends } from "./window-order.ts";

/** Records the two ordering sends `raiseWindow` may make. */
function ordering(): { sent: string[]; sends: WindowOrderSends } {
	const sent: string[] = [];
	return {
		sent,
		sends: {
			makeKeyAndOrderFront: () => sent.push("makeKeyAndOrderFront:"),
			orderFrontRegardless: () => sent.push("orderFrontRegardless"),
		},
	};
}

/** Records every activation selector a create could send. */
function raising(): { sent: string[]; sends: RaiseSends } {
	const sent: string[] = [];
	return {
		sent,
		sends: {
			sharedApp: () => 7,
			isActive: () => {
				sent.push("isActive");
				return false;
			},
			activateIgnoringOtherApps: () => {
				sent.push("activateIgnoringOtherApps:");
			},
		},
	};
}

describe("window.create activate: false", () => {
	beforeEach(() => {
		resetActivation();
	});

	test("orders the window front without taking key", () => {
		const { sent, sends } = ordering();
		expect(raiseWindow(false, sends)).toBe(false);
		expect(sent).toEqual(["orderFrontRegardless"]);
	});

	test("an ordinary create still makes the window key", () => {
		const { sent, sends } = ordering();
		expect(raiseWindow(undefined, sends)).toBe(true);
		expect(sent).toEqual(["makeKeyAndOrderFront:", "orderFrontRegardless"]);
	});

	test("never calls the activation selector, whatever app.activate says", () => {
		const { sent, sends } = raising();
		const once: string[] = [];
		const mode = createActivation("always", false);
		expect(mode).toBe("never");
		expect(activateForWindow(mode, () => once.push("-activate"), sends)).toBe(false);
		expect(sent).toEqual([]);
		expect(once).toEqual([]);
	});

	test("the control: the same create with activate absent does send it", () => {
		const { sent, sends } = raising();
		const once: string[] = [];
		expect(
			activateForWindow(
				createActivation("always", undefined),
				() => once.push("-activate"),
				sends,
			),
		).toBe(true);
		expect(sent).toEqual(["isActive", "activateIgnoringOtherApps:"]);
		expect(once).toEqual(["-activate"]);
	});

	test("the real AppKit sends are the same shape the recording double proves", () => {
		// Not called: this only proves the production object is the one `RaiseSends` describes, so the
		// negative test above is about the shipped path rather than a lookalike.
		expect(appkitRaiseSends()).toMatchObject({
			sharedApp: expect.any(Function),
			isActive: expect.any(Function),
			activateIgnoringOtherApps: expect.any(Function),
		});
	});
});
