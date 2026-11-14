/**
 * `crust:dialog`'s `savePanel`, without AppKit.
 *
 * Split from `dialog.test.ts`: the same seam, but its own contract — an adapter
 * written before the save panel existed keeps type-checking and reports the gap,
 * the panel's own overwrite confirmation is never duplicated here, and a pending
 * answer stays pending until the native one arrives.
 */

import { describe, expect, test } from "bun:test";
import {
	createDialogPlugin,
	dialogPlugin,
	type SavePanelOptions,
	type SavePanelResult,
} from "@/plugins/dialog.ts";
import { isNotImplemented } from "@/plugins/define.ts";

describe("dialog.savePanel", () => {
	/** No adapter at all is a gap, not a cancel. */
	test("answers not-implemented without a native half", async () => {
		const result = await createDialogPlugin().commands.savePanel({});
		expect(isNotImplemented(result)).toBe(true);
		if (isNotImplemented(result)) {
			expect(result.requires).toBe("NSSavePanel");
			expect(result.message).toContain("pickSave");
		}
	});

	/**
	 * An adapter written before the save panel existed keeps type-checking,
	 * and the honest answer for it is still `not-implemented` naming the
	 * selector — never an empty list.
	 */
	test("an open-only adapter reports the gap instead of a cancel", async () => {
		const plugin = createDialogPlugin({ pickOpen: async () => ({ paths: [] }) });
		const result = await plugin.commands.savePanel({});
		expect(isNotImplemented(result)).toBe(true);
	});

	test("the default export stays adapter-less for both panels", async () => {
		expect(isNotImplemented(await dialogPlugin.commands.savePanel({}))).toBe(true);
	});

	/** The argument rules: the adapter sees exactly what the caller passed. */
	test("forwards title, suggested name and filters unchanged", async () => {
		const seen: SavePanelOptions[] = [];
		const plugin = createDialogPlugin({
			pickOpen: async () => ({ paths: [] }),
			async pickSave(options) {
				seen.push(options);
				return { paths: ["/Users/jyz/Documents/note.md"] };
			},
		});

		const options: SavePanelOptions = {
			title: "Save note",
			suggestedName: "note.md",
			filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
		};
		const result = await plugin.commands.savePanel(options);
		expect(seen).toEqual([options]);
		expect(result).toEqual({ paths: ["/Users/jyz/Documents/note.md"] });
	});

	test("passes the empty options object through", async () => {
		let seen: SavePanelOptions | undefined;
		const plugin = createDialogPlugin({
			pickOpen: async () => ({ paths: [] }),
			async pickSave(options) {
				seen = options;
				return { paths: [] };
			},
		});
		await plugin.commands.savePanel({});
		expect(seen).toEqual({});
	});

	/** An empty list is the user cancelling the save, a real answer. */
	test("resolves the native's empty list as a cancel", async () => {
		const plugin = createDialogPlugin({
			pickOpen: async () => ({ paths: [] }),
			pickSave: async () => ({ paths: [] }),
		});
		expect(await plugin.commands.savePanel({})).toEqual({ paths: [] });
	});

	/**
	 * The pending branch: while the sheet is up the command must stay
	 * unsettled, then resolve with the one path the panel returned.
	 */
	test("stays pending until the native answers, then resolves the path", async () => {
		let answer: (result: SavePanelResult) => void = () => {};
		const pending = new Promise<SavePanelResult>((resolve) => {
			answer = resolve;
		});
		const plugin = createDialogPlugin({
			pickOpen: async () => ({ paths: [] }),
			pickSave: () => pending,
		});

		let settled = false;
		const call = plugin.commands.savePanel({ suggestedName: "note.md" }).then((result) => {
			settled = true;
			return result;
		});
		await Bun.sleep(5);
		expect(settled).toBe(false);

		answer({ paths: ["/tmp/note.md"] });
		expect(await call).toEqual({ paths: ["/tmp/note.md"] });
	});

	test("propagates a native refusal as an error, not a cancel", async () => {
		const plugin = createDialogPlugin({
			pickOpen: async () => ({ paths: [] }),
			pickSave: async () => {
				throw new Error(
					"crust: savePanel failed (unsupported); NSSavePanel could not be shown",
				);
			},
		});
		await expect(plugin.commands.savePanel({})).rejects.toThrow(/unsupported/);
	});

	/**
	 * Overwrite confirmation belongs to the panel: a native answer naming an
	 * existing file resolves as-is, with no second prompt from crust and no
	 * existence check of our own.
	 */
	test("returns an existing path unharmed instead of asking again", async () => {
		const existing = "/etc/hosts";
		const plugin = createDialogPlugin({
			pickOpen: async () => ({ paths: [] }),
			pickSave: async () => ({ paths: [existing] }),
		});
		expect(await plugin.commands.savePanel({ suggestedName: "hosts" })).toEqual({
			paths: [existing],
		});
	});
});
