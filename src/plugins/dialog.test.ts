/**
 * `crust:dialog` on its own, with no AppKit nearby: the plugin owns no native code, forwards to a `DialogNative`, and turns a missing adapter into a typed `NotImplemented` — the contract a non-macOS platform and a headless process both rely on. `savePanel` has its own file (`dialog-save.test.ts`).
 */

import { describe, expect, test } from "bun:test";
import { createDialogPlugin, dialogPlugin, type OpenPanelOptions } from "@/plugins/dialog.ts";
import { isNotImplemented } from "@/plugins/define.ts";

/**
 * The page-level cancel. It exists because a sheet is otherwise only
 * dismissible by a human, and because one sheet at a time means a refused
 * request leaves a page behind a panel it cannot answer.
 */
describe("dialog.cancel", () => {
	test("answers not-implemented without a native half", async () => {
		const result = await createDialogPlugin().commands.cancel();
		expect(isNotImplemented(result)).toBe(true);
		if (isNotImplemented(result)) {
			expect(result.requires).toBe("cancel:");
			expect(result.message).toContain("cancel");
		}
	});

	/** An adapter written before cancel existed is a gap, not a silent no-op. */
	test("an adapter with no cancel reports the gap", async () => {
		const plugin = createDialogPlugin({ pickOpen: async () => ({ paths: [] }) });
		expect(isNotImplemented(await plugin.commands.cancel())).toBe(true);
	});

	test("forwards the native's answer unchanged", async () => {
		let calls = 0;
		const plugin = createDialogPlugin({
			pickOpen: async () => ({ paths: [] }),
			async cancel() {
				calls++;
				return { cancelled: true, paths: [] };
			},
		});
		expect(await plugin.commands.cancel()).toEqual({ cancelled: true, paths: [] });
		expect(calls).toBe(1);
	});

	/**
	 * "Nothing was up" is a real answer a page acts on: the page races the
	 * user's own click, so the sheet being gone is ordinary, and turning it into
	 * an error would make a completed pick look like a broken cancel.
	 */
	test("nothing pending is cancelled:false, never an error", async () => {
		const plugin = createDialogPlugin({
			pickOpen: async () => ({ paths: [] }),
			cancel: async () => ({ cancelled: false, paths: [] }),
		});
		const result = await plugin.commands.cancel();
		expect(result).toEqual({ cancelled: false, paths: [] });
		expect(isNotImplemented(result)).toBe(false);
	});

	test("propagates a native refusal instead of reporting a cancel", async () => {
		const plugin = createDialogPlugin({
			pickOpen: async () => ({ paths: [] }),
			cancel: async () => {
				throw new Error("crust: cancel sent -cancel: but the sheet had not ended");
			},
		});
		await expect(plugin.commands.cancel()).rejects.toThrow(/had not ended/);
	});

	test("the default export stays adapter-less", async () => {
		expect(isNotImplemented(await dialogPlugin.commands.cancel())).toBe(true);
	});
});

describe("dialog plugin", () => {
	/** Without a native half the honest answer is "not implemented", never []. */
	test("answers not-implemented without a native half", async () => {
		const result = await createDialogPlugin().commands.openPanel({});
		expect(isNotImplemented(result)).toBe(true);
		if (isNotImplemented(result)) {
			expect(result.requires).toBe("NSOpenPanel");
			expect(result.message).toContain("DialogNative");
		}
	});

	/** The exported default is the adapter-less one; AppKit arrives per app. */
	test("the default export stays adapter-less", async () => {
		expect(dialogPlugin.name).toBe("dialog");
		const result = await dialogPlugin.commands.openPanel({});
		expect(isNotImplemented(result)).toBe(true);
	});

	test("forwards the options to the native half unchanged", async () => {
		const seen: OpenPanelOptions[] = [];
		const plugin = createDialogPlugin({
			async pickOpen(options) {
				seen.push(options);
				return { paths: ["/tmp/a.txt", "/tmp/b.txt"] };
			},
		});

		const options: OpenPanelOptions = {
			title: "Pick something",
			multiple: true,
			directory: false,
			filters: [{ name: "Text", extensions: ["txt"] }],
		};
		const result = await plugin.commands.openPanel(options);
		expect(seen).toEqual([options]);
		expect(result).toEqual({ paths: ["/tmp/a.txt", "/tmp/b.txt"] });
	});

	/** An empty list is a cancel, and a cancel is a real answer, not a gap. */
	test("resolves the native's empty list as a cancel", async () => {
		const plugin = createDialogPlugin({ pickOpen: async () => ({ paths: [] }) });
		const result = await plugin.commands.openPanel({});
		expect(result).toEqual({ paths: [] });
		expect(isNotImplemented(result)).toBe(false);
	});

	/**
	 * A native half that cannot show a panel rejects. The plugin must not turn
	 * that into `{ paths: [] }`, which would read as "the user cancelled" and
	 * hide a broken picker behind an ordinary answer.
	 */
	test("propagates a native rejection instead of reporting a cancel", async () => {
		const plugin = createDialogPlugin({
			pickOpen: async () => {
				throw new Error("crust: openPanel failed (unsupported)");
			},
		});
		await expect(plugin.commands.openPanel({})).rejects.toThrow(/unsupported/);
	});
});
