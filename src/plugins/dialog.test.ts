/**
 * `crust:dialog` on its own, with no AppKit anywhere near it.
 *
 * The plugin owns no native code: it forwards to a `DialogNative` and turns a
 * missing adapter into a typed `NotImplemented`. That contract is what a
 * non-macOS platform and a headless process both rely on, so it is asserted
 * here rather than only through the Darwin adapter.
 */

import { describe, expect, test } from "bun:test";
import {
	createDialogPlugin,
	dialogPlugin,
	type OpenPanelOptions,
	type SavePanelOptions,
	type SavePanelResult,
} from "@/plugins/dialog.ts";
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

	describe("savePanel", () => {
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
});
