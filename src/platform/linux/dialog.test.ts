/**
 * The Linux dialog adapter, proved without GTK: every assertion is about the arguments that reach C
 * and the status machine that answers them. The panel itself needs a person to click it and a display
 * server to show it, and this machine has neither — so the click is what these tests deliberately do
 * not claim, and the cancel path is what they do.
 */
import { describe, expect, test } from "bun:test";
import type { LinuxPlatform } from "@/platform/linux/platform.ts";
import { createDialogPlugin } from "@/plugins/dialog.ts";
import { LINUX_DIALOG_STATUS, LINUX_DIALOG_START, linuxDialogAdapter } from "./dialog.ts";
import { fakeDialogShim } from "./dialog-fake.ts";

/** A platform stand-in: the adapter only ever asks it which window is open. */
function platformWith(win: bigint | undefined): LinuxPlatform {
	return {
		windowLabels: () => (win === undefined ? [] : ["main"]),
		nativeWindow: () => (win === undefined ? undefined : { win, web: 1n, url: "http://x/" }),
	} as unknown as LinuxPlatform;
}

describe("dialog.openPanel on Linux", () => {
	test("hands GTK the title, the filter spec, both flags and the parent window", async () => {
		const fake = fakeDialogShim({ paths: ["/home/jyz/a.txt"] });
		const native = linuxDialogAdapter(platformWith(4242n), fake.symbols);

		const pick = native.pickOpen({
			title: "Open a note",
			multiple: true,
			filters: [{ name: "Text", extensions: ["txt", ".md"] }],
		});
		fake.status = LINUX_DIALOG_STATUS.accepted;

		expect(await pick).toEqual({ paths: ["/home/jyz/a.txt"] });
		expect(fake.calls[0]).toBe("open:Open a note:Text|*.txt;*.md:1:0:4242");
	});

	test("a directory pick asks GTK for the folder action", async () => {
		const fake = fakeDialogShim({ paths: ["/home/jyz/notes"] });
		const native = linuxDialogAdapter(platformWith(undefined), fake.symbols);

		const pick = native.pickOpen({ directory: true });
		fake.status = LINUX_DIALOG_STATUS.accepted;

		expect(await pick).toEqual({ paths: ["/home/jyz/notes"] });
		// No window: the parent is the null pointer, never a guessed one.
		expect(fake.calls[0]).toBe("open:::0:1:0");
	});

	test("several paths come back in the order GTK answered them", async () => {
		const paths = ["/a", "/b", "/c"];
		const fake = fakeDialogShim({ paths });
		const native = linuxDialogAdapter(undefined, fake.symbols);

		const pick = native.pickOpen({ multiple: true });
		fake.status = LINUX_DIALOG_STATUS.accepted;

		expect(await pick).toEqual({ paths });
	});

	/** A cancel is the human's answer, not an error and not an empty implementation. */
	test("a cancelled panel resolves an empty list and releases the dialog", async () => {
		const fake = fakeDialogShim();
		const native = linuxDialogAdapter(undefined, fake.symbols);

		const pick = native.pickOpen({});
		fake.status = LINUX_DIALOG_STATUS.cancelled;

		expect(await pick).toEqual({ paths: [] });
		expect(fake.calls).toContain("release");
	});

	/** The refusal names the entry point, which is what an old GTK needs to be told. */
	test("a GTK without GtkFileChooserNative is named", async () => {
		const fake = fakeDialogShim({ ready: false, missing: "gtk_file_chooser_native_new" });
		const native = linuxDialogAdapter(undefined, fake.symbols);

		await expect(native.pickOpen({})).rejects.toThrow(
			/needs GtkFileChooserNative \(GTK 3\.20\+\): gtk_file_chooser_native_new did not resolve/,
		);
	});

	test("a panel GTK refused to build is an error, not an empty pick", async () => {
		const fake = fakeDialogShim({ start: LINUX_DIALOG_START.refused });
		const native = linuxDialogAdapter(undefined, fake.symbols);

		await expect(native.pickOpen({})).rejects.toThrow(/could not be shown \(status -3\)/);
	});

	test("an accepted panel with no path is malformed, never an empty success", async () => {
		const fake = fakeDialogShim({ paths: [] });
		const native = linuxDialogAdapter(undefined, fake.symbols);

		const pick = native.pickOpen({});
		fake.status = LINUX_DIALOG_STATUS.accepted;

		await expect(pick).rejects.toThrow(/outside 1…16/);
	});
});

describe("dialog.savePanel on Linux", () => {
	test("hands GTK the suggested name, which is a name and not a path", async () => {
		const fake = fakeDialogShim({ paths: ["/home/jyz/notes/a.md"] });
		const native = linuxDialogAdapter(undefined, fake.symbols);

		const pick = native.pickSave({
			title: "Save note",
			suggestedName: "a.md",
			filters: [{ name: "Markdown", extensions: ["md"] }],
		});
		fake.status = LINUX_DIALOG_STATUS.accepted;

		expect(await pick).toEqual({ paths: ["/home/jyz/notes/a.md"] });
		expect(fake.calls[0]).toBe("save:Save note:a.md:Markdown|*.md:0");
	});
});

describe("dialog.cancel on Linux", () => {
	/**
	 * The whole reason this platform shows the panel instead of running it: the pump keeps turning,
	 * so a page can end a panel it no longer wants and its own pick answers the empty list a cancel
	 * means — the same answer a human's Cancel button gives.
	 */
	test("ends a pending panel, and the pending pick answers an empty list", async () => {
		const fake = fakeDialogShim();
		const native = linuxDialogAdapter(undefined, fake.symbols);

		const pick = native.pickOpen({});
		expect(await native.cancel()).toEqual({ cancelled: true, paths: [] });
		expect(await pick).toEqual({ paths: [] });
	});

	test("nothing pending answers cancelled:false, which is an ordinary race", async () => {
		const fake = fakeDialogShim();
		const native = linuxDialogAdapter(undefined, fake.symbols);
		expect(await native.cancel()).toEqual({ cancelled: false, paths: [] });
	});
});

describe("the plugin wiring", () => {
	test("a pick through createDialogPlugin answers paths, not not-implemented", async () => {
		const fake = fakeDialogShim({ paths: ["/one"] });
		const native = linuxDialogAdapter(undefined, fake.symbols);
		const plugin = createDialogPlugin(native);

		const pick = plugin.commands.openPanel({ title: "x" });
		fake.status = LINUX_DIALOG_STATUS.accepted;

		expect(await pick).toEqual({ paths: ["/one"] });
	});
});
