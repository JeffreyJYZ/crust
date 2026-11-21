/**
 * `testing.activation` against the accessibility read it governs: `none` refuses by name instead of
 * answering the empty tree activation would explain, and `on-demand` raises the app exactly once no
 * matter how many reads follow. The adapter and the raise are doubles, so no AppKit is involved —
 * the plugin's decision is the thing under test.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { createAccessibilityPlugin } from "./accessibility.ts";
import { AX_STATUS, type AccessibilityAdapter } from "./accessibility-types.ts";
import {
	resetActivationPolicy,
	setActivationRaise,
	setTestingActivation,
} from "./activation-policy.ts";

function adapter(count = 4): { adapter: AccessibilityAdapter; reads: () => number } {
	let reads = 0;
	return {
		reads: () => reads,
		adapter: {
			trusted: () => true,
			prompt: () => true,
			elementCount: () => {
				reads++;
				return { count, status: AX_STATUS.counted, reason: "counted" };
			},
		},
	};
}

describe("testing.activation and accessibility.elementCount", () => {
	beforeEach(() => {
		resetActivationPolicy();
	});

	test("auto reads the tree and never activates on its own", async () => {
		const native = adapter();
		let raised = 0;
		setActivationRaise(() => raised++);
		const plugin = createAccessibilityPlugin(native.adapter);
		expect(await plugin.commands.elementCount()).toEqual({ ok: true, count: 4 });
		expect(native.reads()).toBe(1);
		expect(raised).toBe(0);
	});

	test('"none" refuses by name and never reads an empty tree', async () => {
		setTestingActivation("none");
		const native = adapter();
		let raised = 0;
		setActivationRaise(() => raised++);
		const plugin = createAccessibilityPlugin(native.adapter);
		const answer = await plugin.commands.elementCount();
		expect(answer).toMatchObject({ ok: false, code: "needs-activation" });
		if (!answer.ok && "message" in answer) {
			expect(answer.message).toContain("testing.activation");
			expect(answer.message).toContain("none");
		}
		expect(native.reads()).toBe(0);
		expect(raised).toBe(0);
	});

	test('"on-demand" raises the app once and answers every read', async () => {
		setTestingActivation("on-demand");
		const native = adapter(6);
		let raised = 0;
		setActivationRaise(() => raised++);
		const plugin = createAccessibilityPlugin(native.adapter);
		expect(await plugin.commands.elementCount()).toEqual({ ok: true, count: 6 });
		expect(await plugin.commands.elementCount()).toEqual({ ok: true, count: 6 });
		expect(raised).toBe(1);
		expect(native.reads()).toBe(2);
	});
});
