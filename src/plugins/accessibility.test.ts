/**
 * `crust:accessibility` proofs. `crust_ax_prompt` is never called here: it raises a real system
 * dialog, and a test that asked the person at the machine for a permission it does not need would be
 * a defect. Trust and the element walk are reads, so those run for real; the prompt's contract is
 * proven with a fake.
 */

import { describe, expect, test } from "bun:test";
import {
	ACCESSIBILITY_SYMBOL_NAMES,
	accessibilityUnit,
	accessibilityUnitStatus,
	AX_STATUS,
	darwinAccessibilityAdapter,
} from "@/platform/darwin/accessibility.ts";
import { isNotImplemented } from "@/plugins/define.ts";
import {
	ACCESSIBILITY_COMMANDS,
	type AccessibilityAdapter,
	createAccessibilityPlugin,
	accessibilityPlugin,
} from "@/plugins/accessibility.ts";

interface Recorded {
	adapter: AccessibilityAdapter;
	calls: string[];
}

/** A plain object: `mock.fn` does not exist in `bun:test`, and a fake is just a value. */
function fake(overrides: Partial<AccessibilityAdapter> = {}): Recorded {
	const calls: string[] = [];
	const adapter: AccessibilityAdapter = {
		trusted: () => {
			calls.push("trusted");
			return true;
		},
		prompt: () => {
			calls.push("prompt");
			return false;
		},
		elementCount: () => {
			calls.push("elementCount");
			return {
				count: 3,
				status: AX_STATUS.counted,
				reason: "the window exposes AX children",
			};
		},
		...overrides,
	};
	return { adapter, calls };
}

describe("106_accessibility.c", () => {
	test("compiles through cc(), links ApplicationServices, exports the declared symbols", () => {
		const compiled = accessibilityUnit();
		expect(Number(compiled.symbols.crust_ax_abi())).toBe(1);
		expect(accessibilityUnitStatus()).toEqual({ available: true, reason: "compiled" });
		for (const name of ACCESSIBILITY_SYMBOL_NAMES) {
			expect(typeof (compiled.symbols as unknown as Record<string, unknown>)[name]).toBe(
				"function",
			);
		}
		expect(Object.keys(compiled.symbols).sort()).toEqual(
			[...ACCESSIBILITY_SYMBOL_NAMES].sort(),
		);
	});

	test("trust is a read that answers 0 or 1 and never prompts", () => {
		const compiled = accessibilityUnit();
		const trusted = Number(compiled.symbols.crust_ax_trusted());
		expect([0, 1]).toContain(trusted);
		expect(String(compiled.symbols.crust_ax_reason())).toContain("trusted");
	});

	test("the element walk answers a count, a missing window or a refusal, never a crash", () => {
		const answer = Number(accessibilityUnit().symbols.crust_ax_element_count());
		expect(Number.isInteger(answer)).toBe(true);
		// A bun test process has no window, so the honest answers are -1 or -2; a count is possible
		// on a machine that exposes one, so the assertion is the range rather than a fixed value.
		expect(answer).toBeGreaterThanOrEqual(-2);
	});
});

describe("accessibility plugin shape", () => {
	test("is named accessibility and declares exactly the three commands", () => {
		const plugin = createAccessibilityPlugin(fake().adapter);
		expect(plugin.name).toBe("accessibility");
		expect(Object.keys(plugin.commands).sort()).toEqual([...ACCESSIBILITY_COMMANDS].sort());
		expect(Object.isFrozen(plugin)).toBe(true);
	});

	test("the default export is the adapter-less one", () => {
		expect(accessibilityPlugin.name).toBe("accessibility");
		expect(Object.keys(accessibilityPlugin.commands).sort()).toEqual(
			[...ACCESSIBILITY_COMMANDS].sort(),
		);
	});
});

describe("accessibility commands with an adapter", () => {
	test("trusted relays the adapter's answer", async () => {
		expect(await createAccessibilityPlugin(fake().adapter).commands.trusted()).toEqual({
			ok: true,
			trusted: true,
		});
	});

	test("prompt reports that it asked, and whatever trust came back", async () => {
		const { adapter, calls } = fake();
		expect(await createAccessibilityPlugin(adapter).commands.prompt()).toEqual({
			ok: true,
			trusted: false,
			prompted: true,
		});
		expect(calls).toEqual(["prompt"]);
	});

	test("elementCount relays a real count, zero included", async () => {
		const counted = fake({
			elementCount: () => ({ count: 0, status: AX_STATUS.counted, reason: "no children" }),
		});
		expect(await createAccessibilityPlugin(counted.adapter).commands.elementCount()).toEqual({
			ok: true,
			count: 0,
		});
		expect(await createAccessibilityPlugin(fake().adapter).commands.elementCount()).toEqual({
			ok: true,
			count: 3,
		});
	});
});

describe("accessibility refusals", () => {
	test("an absent adapter is not-implemented, naming AXIsProcessTrusted", async () => {
		const answer = await accessibilityPlugin.commands.trusted();
		expect(isNotImplemented(answer)).toBe(true);
		expect(answer).toMatchObject({ requires: "AXIsProcessTrusted" });
	});

	test("an empty AX window list answers 0 with not-implemented, naming the AX call", async () => {
		const { adapter } = fake({
			elementCount: () => ({
				count: 0,
				status: AX_STATUS.noWindowsListed,
				reason: "AXWindows answered an empty list for this process",
			}),
		});
		const answer = await createAccessibilityPlugin(adapter).commands.elementCount();
		expect(isNotImplemented(answer)).toBe(true);
		expect(answer).toMatchObject({ requires: "AXUIElementCopyAttributeValue (AXWindows)" });
		const message = (answer as { message: string }).message;
		expect(message).toContain("0 elements");
		// The measured truth: an empty list is not evidence the window is missing, and the refusal
		// must not say it is.
		expect(message).toContain("not evidence that the window is missing");
		expect(message).not.toContain("no window is up");
	});

	test("a refused walk names the AX call that refused", async () => {
		const { adapter } = fake({
			elementCount: () => ({
				count: 0,
				status: AX_STATUS.refused,
				reason: "AXWindows refused",
			}),
		});
		const answer = await createAccessibilityPlugin(adapter).commands.elementCount();
		expect(isNotImplemented(answer)).toBe(true);
		expect(answer).toMatchObject({ requires: "AXUIElementCopyAttributeValue" });
	});
});

describe("the real adapter, without prompting", () => {
	test("trusted and elementCount are reads that answer typed values", () => {
		const adapter = darwinAccessibilityAdapter();
		expect(typeof adapter.trusted()).toBe("boolean");
		const report = adapter.elementCount();
		expect(typeof report.count).toBe("number");
		expect([
			AX_STATUS.counted,
			AX_STATUS.noWindowsListed,
			AX_STATUS.refused,
		] as number[]).toContain(report.status);
	});
});
