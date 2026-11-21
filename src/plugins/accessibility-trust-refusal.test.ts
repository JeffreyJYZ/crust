/**
 * `crust:accessibility` must answer a typed refusal when an app-supplied adapter throws on the two
 * trust reads. `prompt` already does; `trusted` and `elementCount` used to let the throw escape the
 * invoke. No real AX call is made here — the adapter is a stand-in that throws on demand.
 */

import { describe, expect, test } from "bun:test";

import {
	AX_STATUS,
	type AccessibilityAdapter,
	createAccessibilityPlugin,
} from "@/plugins/accessibility";

const FAILURE = "the native bridge is unavailable";

function adapter(trusted: () => boolean | Promise<boolean>): AccessibilityAdapter {
	return {
		trusted,
		prompt: () => true,
		elementCount: () => ({ count: 0, status: AX_STATUS.counted, reason: "no children" }),
	};
}

function countAdapter(elementCount: () => { count: number; status: number; reason: string }) {
	return {
		trusted: () => true,
		prompt: () => true,
		elementCount,
	};
}

describe("accessibility trust-read refusals", () => {
	test("a throwing trusted() becomes a typed handler-error carrying its message", async () => {
		const plugin = createAccessibilityPlugin(
			adapter(() => {
				throw new Error(FAILURE);
			}),
		);
		expect(await plugin.commands.trusted()).toEqual({
			ok: false,
			code: "handler-error",
			message: FAILURE,
		});
	});

	test("a throwing elementCount() becomes the same typed handler-error", async () => {
		const plugin = createAccessibilityPlugin(
			countAdapter(() => {
				throw new Error(FAILURE);
			}),
		);
		expect(await plugin.commands.elementCount()).toEqual({
			ok: false,
			code: "handler-error",
			message: FAILURE,
		});
	});

	test("a normal read still answers its value, not a refusal", async () => {
		const plugin = createAccessibilityPlugin(adapter(() => true));
		expect(await plugin.commands.trusted()).toEqual({ ok: true, trusted: true });
	});
});
