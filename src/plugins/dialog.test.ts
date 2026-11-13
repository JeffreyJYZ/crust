/**
 * `crust:dialog` on its own, with no AppKit anywhere near it.
 *
 * The plugin owns no native code: it forwards to a `DialogNative` and turns a
 * missing adapter into a typed `NotImplemented`. That contract is what a
 * non-macOS platform and a headless process both rely on, so it is asserted
 * here rather than only through the Darwin adapter.
 */

import { describe, expect, test } from "bun:test";
import { createDialogPlugin, dialogPlugin, type OpenPanelOptions } from "@/plugins/dialog.ts";
import { isNotImplemented } from "@/plugins/define.ts";

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
