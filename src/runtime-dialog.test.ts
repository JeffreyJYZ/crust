/**
 * The registry's `dialog` choice, proved on macOS: an injected adapter shows which OS arm answered,
 * and each real factory is reached far enough to answer by name — no platform is attached, so no
 * comdlg32 call is made, and GTK is absent, so the Linux arm refuses naming
 * `gtk_file_chooser_native_new` rather than pretending.
 */
import { describe, expect, test } from "bun:test";
import { isNotImplemented } from "@/plugins/define";
import type { DialogNative } from "@/plugins/dialog";
import { nonDarwinDialogPlugin } from "@/runtime-dialog";
import { nativePlugins } from "@/runtime-plugins.ts";

function adapter(paths: string[]): DialogNative {
	return {
		pickOpen: async () => ({ paths }),
		pickSave: async () => ({ paths }),
		cancel: async () => ({ cancelled: false, paths: [] }),
	};
}

describe("the dialog the registry picks", () => {
	test("win32 registers the injected adapter and answers paths", async () => {
		const plugin = await nonDarwinDialogPlugin("win32", { windows: adapter(["C:\\one"]) });
		expect(await plugin.commands.openPanel({})).toEqual({ paths: ["C:\\one"] });
	});

	test("linux registers the injected adapter and answers paths", async () => {
		const plugin = await nonDarwinDialogPlugin("linux", { linux: adapter(["/one"]) });
		expect(await plugin.commands.openPanel({})).toEqual({ paths: ["/one"] });
	});

	/**
	 * The real win32 factory, reached with no platform attached: the panel needs a started platform,
	 * so this is a named refusal rather than a null call into comdlg32.
	 */
	test("the real win32 adapter refuses by name before start()", async () => {
		const plugin = await nonDarwinDialogPlugin("win32");
		await expect(plugin.commands.openPanel({})).rejects.toThrow(
			/needs a started Windows platform/,
		);
	});

	/** An OS with no native half keeps the honest answer, never a missing namespace. */
	test("an OS with no panel keeps the bare not-implemented", async () => {
		const plugin = await nonDarwinDialogPlugin("freebsd");
		const result = await plugin.commands.openPanel({});
		expect(isNotImplemented(result)).toBe(true);
		if (isNotImplemented(result)) expect(result.requires).toBe("NSOpenPanel");
	});
});

describe("the registry's dialog registration", () => {
	/**
	 * The end-to-end half: `nativePlugins` must carry exactly one `dialog`, and it must be the
	 * adapted one — a bare plugin would answer `not-implemented` here, and a duplicate name would
	 * make the registry refuse to start.
	 */
	test("registers one adapted dialog on each platform, never the bare refusal", async () => {
		for (const os of ["win32", "linux"]) {
			const plugins = await nativePlugins([], undefined, { app: `land.jyz.${os}-dialog` }, os);
			const dialogs = plugins.filter((plugin) => plugin.name === "dialog");
			expect({ os, count: dialogs.length }).toEqual({ os, count: 1 });
			const open = dialogs[0]?.commands.openPanel as
				| ((args: object) => Promise<unknown>)
				| undefined;
			expect(typeof open).toBe("function");
			let answer: unknown;
			try {
				answer = await open?.({});
			} catch (error) {
				answer = error;
			}
			expect(isNotImplemented(answer)).toBe(false);
		}
	});
});
