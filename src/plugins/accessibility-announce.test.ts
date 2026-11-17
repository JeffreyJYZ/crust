/**
 * `crust:accessibility`'s page-facing half: `announce`, `title` and `focus`. These are what Butter's
 * `a11y:*` trio did, and without them the plugin is only a trust probe — a namesake, not an equivalent.
 * Every case here uses a fake adapter, so no announcement is posted and no window is touched.
 */

import { describe, expect, test } from "bun:test";

import {
	ACCESSIBILITY_COMMANDS,
	accessibilityNeed,
	createAccessibilityPlugin,
	hasAnnouncement,
} from "@/plugins/accessibility.ts";
import { AX_STATUS, type AccessibilityAdapter } from "@/plugins/accessibility-types.ts";
import { isNotImplemented } from "@/plugins/define.ts";

interface Recorded {
	adapter: AccessibilityAdapter;
	calls: string[];
}

/** A fake that records what was asked, so "it returned ok" cannot hide a call never made. */
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
			return { count: 1, status: AX_STATUS.counted, reason: "one child" };
		},
		announce: (text, priority) => {
			calls.push(`announce:${priority}:${text}`);
			return { announced: true, reason: "posted" };
		},
		title: (text, label) => {
			calls.push(`title:${label ?? ""}:${text}`);
			return { titled: true, reason: "applied" };
		},
		focus: (label) => {
			calls.push(`focus:${label ?? ""}`);
			return { focused: true, reason: "moved" };
		},
		...overrides,
	};
	return { adapter, calls };
}

describe("the page-facing commands exist", () => {
	test("the plugin declares announce, title and focus beside the trust probe", () => {
		const plugin = createAccessibilityPlugin(fake().adapter);
		expect(Object.keys(plugin.commands).sort()).toEqual([...ACCESSIBILITY_COMMANDS].sort());
		for (const command of ["announce", "title", "focus"]) {
			expect(typeof (plugin.commands as Record<string, unknown>)[command]).toBe("function");
		}
	});
});

describe("announce", () => {
	test("relays the text and defaults the priority to polite", async () => {
		const { adapter, calls } = fake();
		const answer = await createAccessibilityPlugin(adapter).commands.announce({
			text: "Saved",
		});
		expect(calls).toEqual(["announce:polite:Saved", "trusted"]);
		expect(answer).toMatchObject({
			ok: true,
			announced: true,
			trusted: true,
			priority: "polite",
		});
	});

	test("assertive is passed through, and an unknown priority falls back to polite", async () => {
		const { adapter, calls } = fake();
		const plugin = createAccessibilityPlugin(adapter);
		await plugin.commands.announce({ text: "Error", priority: "assertive" });
		await plugin.commands.announce({ text: "Later", priority: "shout" });
		expect(calls).toEqual([
			"announce:assertive:Error",
			"trusted",
			"announce:polite:Later",
			"trusted",
		]);
	});

	test("an untrusted process still announces, and the answer says so", async () => {
		// The OS drops an untrusted announcement; it does not refuse the post. Reporting a refusal here
		// would claim a policy the OS does not apply, which is the defect this case pins.
		const { adapter, calls } = fake({ trusted: () => false });
		const answer = await createAccessibilityPlugin(adapter).commands.announce({ text: "Hi" });
		expect(calls).toContain("announce:polite:Hi");
		expect(answer).toMatchObject({ ok: true, announced: true, trusted: false });
	});

	test("an empty text is refused by name and never reaches the adapter", async () => {
		const { adapter, calls } = fake();
		const answer = await createAccessibilityPlugin(adapter).commands.announce({ text: "" });
		expect(calls).toEqual([]);
		expect(answer).toMatchObject({ ok: false, code: "bad-request" });
	});
});

describe("title and focus", () => {
	test("title sets the accessible name, and a label reaches the adapter", async () => {
		const { adapter, calls } = fake();
		const plugin = createAccessibilityPlugin(adapter);
		const answer = await plugin.commands.title({ text: "Settings" });
		expect(calls).toEqual(["title::Settings"]);
		expect(answer).toMatchObject({ ok: true, titled: true });
		const named = await plugin.commands.title({ text: "Settings", label: "main" });
		expect(calls).toContain("title:main:Settings");
		expect(named).toMatchObject({ ok: true, titled: true });
	});

	test("focus moves to the named window, and no label means the key window", async () => {
		const { adapter, calls } = fake();
		const plugin = createAccessibilityPlugin(adapter);
		expect(await plugin.commands.focus(undefined)).toMatchObject({ ok: true, focused: true });
		expect(calls).toEqual(["focus:"]);
		expect(await plugin.commands.focus({ label: "main" })).toMatchObject({ ok: true });
		expect(calls).toContain("focus:main");
	});

	test("a thrown adapter is a typed handler-error, never a rejected invoke", async () => {
		const { adapter } = fake({
			announce: () => {
				throw new Error("the announcement dictionary could not be built");
			},
		});
		expect(await createAccessibilityPlugin(adapter).commands.announce({ text: "x" })).toEqual({
			ok: false,
			code: "handler-error",
			message: "the announcement dictionary could not be built",
		});
	});
});

describe("platforms with no announcement surface refuse by name", () => {
	test("Linux names gtk_widget_announce and GTK 3 as the reason", async () => {
		const answer = await accessibilityOnLinux().commands.announce({ text: "Hi" });
		expect(isNotImplemented(answer)).toBe(true);
		const message = (answer as { message: string }).message;
		expect(message).toContain("gtk_widget_announce");
		expect(message).toContain("GTK 3");
	});

	test("Windows refuses EVENT_OBJECT_LIVEREGIONCHANGED as not an announcement", () => {
		const need = accessibilityNeed("announce", "win32");
		expect(need.requires).toContain("EVENT_OBJECT_LIVEREGIONCHANGED");
		expect(need.reason).toContain("not a request to speak");
	});

	test("only macOS claims a real announcement surface", () => {
		expect(hasAnnouncement("darwin")).toBe(true);
		expect(hasAnnouncement("linux")).toBe(false);
		expect(hasAnnouncement("win32")).toBe(false);
	});

	test("an adapter without the method answers not-implemented naming the call", async () => {
		const adapter: AccessibilityAdapter = {
			trusted: () => true,
			prompt: () => true,
			elementCount: () => ({ count: 0, status: AX_STATUS.counted, reason: "" }),
		};
		const answer = await createAccessibilityPlugin(adapter, {
			platform: "linux",
		}).commands.focus(undefined);
		expect(isNotImplemented(answer)).toBe(true);
		expect(answer).toMatchObject({ requires: "gtk_widget_grab_focus" });
	});
});

/** A Linux plugin with no adapter: the shape a non-macOS launch actually has. */
function accessibilityOnLinux() {
	return createAccessibilityPlugin(undefined, { platform: "linux" });
}
