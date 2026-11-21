/**
 * `accessibility.focus`'s refusal shapes. The native adapter answers a report, it never throws a
 * `CrustError`, so "no window matched" must be classified by the handler rather than by a catch the
 * real adapter can never enter.
 */
import { describe, expect, test } from "bun:test";
import { notImplemented } from "@/plugins/define.ts";
import { pageCommands, type PageGuards } from "@/plugins/accessibility-page.ts";
import type { AccessibilityAdapter } from "@/plugins/accessibility-types.ts";

const guards: PageGuards = {
	missing: (command) => notImplemented(`no adapter for ${command}`, "AX"),
	unsupported: (command) => notImplemented(`no ${command} on this platform`, "AX"),
};

function adapter(reason: string, focused = false): AccessibilityAdapter {
	return {
		trusted: () => true,
		prompt: () => true,
		elementCount: () => ({ count: 0, status: 0, reason: "test" }),
		focus: () => ({ focused, reason }),
	};
}

describe("accessibility.focus refusals", () => {
	test("an unknown label is bad-request, the branch the comment promised", async () => {
		const commands = pageCommands(adapter('no AX window matched "ghost"'), guards);
		const answer = await commands.focus({ label: "ghost" });
		expect(answer).toMatchObject({ ok: false, code: "bad-request" });
		if (answer.ok) return;
		expect(answer.message).toContain("ghost");
	});

	test("a native fault is handler-error, not a caller mistake", async () => {
		const commands = pageCommands(adapter("the AX unit could not be compiled"), guards);
		expect(await commands.focus(undefined)).toMatchObject({ ok: false, code: "handler-error" });
	});

	test("a moved focus still answers ok with the native reason", async () => {
		const commands = pageCommands(
			adapter("AXFocusedWindow and AXFocused were set", true),
			guards,
		);
		expect(await commands.focus(undefined)).toEqual({
			ok: true,
			focused: true,
			reason: "AXFocusedWindow and AXFocused were set",
		});
	});
});
