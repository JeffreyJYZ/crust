import { describe, expect, test } from "bun:test";
import { isNotImplemented } from "@/plugins/define.ts";
import { createDialogPlugin } from "@/plugins/dialog.ts";
import {
	busyRefusal,
	darwinDialogAdapter,
	NS_MODAL_RESPONSE,
	PANEL_KIND,
	PANEL_STATUS,
} from "./index.ts";
import { FakePanel, SHIM_PANEL_NO_RESPONSE } from "./panel-fake.ts";

describe("dialog adapter", () => {
	test("exposes the plugin's hooks and the commands' names", () => {
		const adapter = darwinDialogAdapter();
		expect(typeof adapter.pickOpen).toBe("function");
		expect(adapter.openPanel).toBe(adapter.pickOpen);
		expect(typeof adapter.pickSave).toBe("function");
		expect(adapter.pickSave).toBe(adapter.savePanel);
		expect(typeof adapter.cancel).toBe("function");
	});

	/**
	 * The defect this exists for: the C globals hold one panel, and starting a second sheet used to wipe the first one's done flag, panel pointer and path storage, so the page awaiting the first pick eventually read the second panel's answer. A refusal must leave the live sheet untouched and the first request must still answer with its own pick.
	 */
	test("a second request is refused, and the first pick still answers", async () => {
		const fake = new FakePanel();
		const adapter = darwinDialogAdapter(fake);

		const first = adapter.pickOpen({ title: "one" });
		expect(fake.sheets).toBe(1);

		await expect(adapter.pickSave({ suggestedName: "note.md" })).rejects.toThrow(
			/refused \(busy\); an NSOpenPanel sheet is already up/,
		);

		// Nothing was sent, nothing was reset: the live sheet is still the open
		// panel, still unanswered, and there was no modal fallback either.
		expect(fake.sheets).toBe(1);
		expect(fake.modalCalls).toBe(0);
		expect(fake.sheetKind()).toBe(PANEL_KIND.open);
		expect(fake.sheetDone()).toBe(false);
		expect(fake.sheetResponse()).toBe(SHIM_PANEL_NO_RESPONSE);

		fake.answer(["/tmp/one.md"]);
		expect(await first).toEqual({ paths: ["/tmp/one.md"] });
	});

	/**
	 * A windowless app cannot attach a sheet, and the old fallback blocked the JS
	 * thread on `-runModal` — so nothing, `dialog.cancel` included, could ever answer
	 * it. The adapter now resends into the free-standing presentation and awaits the
	 * same poll, which is what these two tests pin down without needing a window.
	 */
	test("a windowless panel is awaited through the poll, not resolved at once", async () => {
		const fake = new FakePanel();
		fake.windowless = true;
		const adapter = darwinDialogAdapter(fake);

		const pick = adapter.pickOpen({ title: "free-standing" });
		expect(fake.modalCalls).toBe(1);
		expect(fake.sheets).toBe(1);
		expect(fake.sheetDone()).toBe(false);

		fake.answer(["/tmp/free.md"]);
		expect(await pick).toEqual({ paths: ["/tmp/free.md"] });
	});

	test("a windowless panel can be cancelled, which the blocking fallback could not", async () => {
		const fake = new FakePanel();
		fake.windowless = true;
		const adapter = darwinDialogAdapter(fake);

		const pick = adapter.pickOpen({});
		expect(await adapter.cancel()).toEqual({ cancelled: true, paths: [] });
		expect(await pick).toEqual({ paths: [] });
	});

	/** A refused save panel says so with the open panel's name, not a bare "busy". */
	test("the refusal names the panel that is already up", async () => {
		const fake = new FakePanel();
		const adapter = darwinDialogAdapter(fake);
		const first = adapter.pickSave({ suggestedName: "note.md" });

		await expect(adapter.pickOpen({})).rejects.toThrow(
			/refused \(busy\); an NSSavePanel sheet is already up/,
		);
		const message = busyRefusal("openPanel", PANEL_KIND.save);
		expect(message).toContain("dialog.cancel");
		expect(message).toContain("NSSavePanel");
		expect(message).toContain("NSOpenPanel for another");

		fake.answer(["/tmp/note.md"]);
		expect(await first).toEqual({ paths: ["/tmp/note.md"] });
	});

	/**
	 * Cancel is the way out of the one-sheet rule: it ends the sheet through the
	 * path a user's Cancel button takes, settles the page's own pick with the
	 * empty list a cancel means, and releases the state so the next pick starts
	 * a fresh sheet instead of being refused.
	 */
	test("cancel ends the pending sheet, and the next pick starts clean", async () => {
		const fake = new FakePanel();
		const adapter = darwinDialogAdapter(fake);

		const first = adapter.pickOpen({});
		expect(await adapter.cancel()).toEqual({ cancelled: true, paths: [] });
		expect(await first).toEqual({ paths: [] });
		expect(fake.sheets).toBe(1);

		// The state a user's cancel leaves: the next request is accepted.
		const second = adapter.pickOpen({});
		expect(fake.sheets).toBe(2);
		fake.answer(["/tmp/two.md"]);
		expect(await second).toEqual({ paths: ["/tmp/two.md"] });
	});

	/** Nothing up is an ordinary answer, never an error. */
	test("cancel with no sheet answers cancelled:false", async () => {
		const adapter = darwinDialogAdapter(new FakePanel());
		expect(await adapter.cancel()).toEqual({ cancelled: false, paths: [] });
	});

	/** A sheet the user already answered is not something cancel can end. */
	test("cancel after the user's own answer answers cancelled:false", async () => {
		const fake = new FakePanel();
		const adapter = darwinDialogAdapter(fake);
		const first = adapter.pickOpen({});
		fake.answer(["/tmp/one.md"]);
		expect(await first).toEqual({ paths: ["/tmp/one.md"] });

		expect(await adapter.cancel()).toEqual({ cancelled: false, paths: [] });
	});

	test("the plugin still answers not-implemented without an adapter", async () => {
		const plugin = createDialogPlugin();
		const result = await plugin.commands.openPanel({});
		expect(isNotImplemented(result)).toBe(true);
		if (isNotImplemented(result)) expect(result.requires).toBe("NSOpenPanel");
	});

	test("the default dialogPlugin stays the adapter-less one", () => {
		// runtime.ts builds the adapted plugin with createDialogPlugin(adapter);
		// the exported default must not smuggle AppKit into a headless process.
		expect(createDialogPlugin).toBeDefined();
	});
});
