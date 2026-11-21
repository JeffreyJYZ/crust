/** A relative path never reaches a surface, and a platform without a panel says what it lacks. */
import { describe, expect, test } from "bun:test";
import { createPreviewPlugin } from "@/plugins/preview";
import type { PreviewSurface } from "@/plugins/preview-surface";

const OFFLINE = { check: async () => {} };

function surface(): PreviewSurface {
	return {
		name: "fake",
		show: () => ({ ok: true, window: 7 }),
		hide: () => ({ ok: true }),
		visible: () => false,
	};
}

describe("preview refusals", () => {
	test("a relative path never reaches the surface", async () => {
		const target = surface();
		let shown = false;
		target.show = () => {
			shown = true;
			return { ok: true, window: 7 };
		};
		const plugin = createPreviewPlugin({ surface: target, scope: OFFLINE });
		await expect(plugin.commands.show({ path: "notes.txt" })).rejects.toMatchObject({
			code: "bad-request",
		});
		expect(shown).toBe(false);
	});

	test("Linux answers the named refusal on both commands", async () => {
		const plugin = createPreviewPlugin({ scope: OFFLINE }, "linux");
		const shown = await plugin.commands.show({ path: "/tmp/a.docx" });
		expect(shown).toMatchObject({ ok: false, code: "not-implemented" });
		expect((shown as { message: string }).message).toContain(
			"Linux has no embedded system preview",
		);
		expect(await plugin.commands.hide()).toMatchObject({ code: "not-implemented" });
	});
});
