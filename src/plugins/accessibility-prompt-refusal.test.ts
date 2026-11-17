/**
 * `crust:accessibility` proof for the prompt's refusal path. `darwinAccessibilityAdapter().prompt()`
 * throws when the AX unit cannot compile; the plugin must convert that to the same typed failure every
 * other system command returns rather than a rejected invoke. No real dialog is raised here.
 */

import { describe, expect, test } from "bun:test";

import {
	AX_STATUS,
	type AccessibilityAdapter,
	createAccessibilityPlugin,
} from "@/plugins/accessibility";

const COMPILE_FAILURE = "the accessibility C unit did not compile";

function fake(prompt: () => boolean): AccessibilityAdapter {
	return {
		trusted: () => true,
		prompt,
		elementCount: () => ({ count: 0, status: AX_STATUS.counted, reason: "no children" }),
	};
}

describe("accessibility.prompt refusal", () => {
	test("a throwing adapter becomes a typed handler-error carrying its message", async () => {
		const plugin = createAccessibilityPlugin(
			fake(() => {
				throw new Error(COMPILE_FAILURE);
			}),
		);
		expect(await plugin.commands.prompt()).toEqual({
			ok: false,
			code: "handler-error",
			message: COMPILE_FAILURE,
		});
	});
});
