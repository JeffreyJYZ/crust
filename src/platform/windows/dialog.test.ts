/**
 * The Windows dialog adapter, proved without comdlg32: every assertion is about the arguments that
 * reach C and the status that comes back, because that is the whole of this layer. The panel itself
 * needs a person to click it, and no test on this machine can do that — which is exactly why the
 * cancel path and the argument mapping are what is pinned here.
 */
import { describe, expect, test } from "bun:test";
import { createDialogPlugin } from "@/plugins/dialog.ts";
import { DIALOG_STATUS, filterSpec, windowsDialogAdapter } from "./dialog.ts";
import { fakeDialogShim } from "./dialog-fake.ts";

const WINDOW = 0x1234;

function adapter(fake = fakeDialogShim({ paths: ["C:\\notes\\a.txt"] }), owner = WINDOW) {
	return { fake, adapter: windowsDialogAdapter({ shim: () => fake.shim, owner: () => owner }) };
}

describe("dialog.openPanel on Windows", () => {
	test("hands C the title, the filter spec, both flags and the owner window", async () => {
		const { fake, adapter: native } = adapter();
		const result = await native.pickOpen({
			title: "Open a note",
			multiple: true,
			filters: [{ name: "Text", extensions: ["txt", ".md"] }],
		});

		expect(fake.calls).toEqual([`open:Open a note:Text|*.txt;*.md:1:0:${WINDOW}`]);
		expect(result).toEqual({ paths: ["C:\\notes\\a.txt"] });
	});

	test("a directory pick is the same call with the folder flag set", async () => {
		const { fake, adapter: native } = adapter(fakeDialogShim({ paths: ["C:\\notes"] }));
		await native.pickOpen({ directory: true });
		expect(fake.calls).toEqual([`open:::0:1:${WINDOW}`]);
	});

	test("several paths come back in the order C answered them", async () => {
		const paths = ["C:\\a.txt", "C:\\b.txt", "C:\\c.txt"];
		const { adapter: native } = adapter(fakeDialogShim({ paths }));
		expect(await native.pickOpen({ multiple: true })).toEqual({ paths });
	});

	/** A cancel is the user's answer, not an error and not an empty implementation. */
	test("a cancelled panel resolves an empty list", async () => {
		const { adapter: native } = adapter(fakeDialogShim({ status: DIALOG_STATUS.cancelled }));
		expect(await native.pickOpen({})).toEqual({ paths: [] });
	});

	/** The refusal names the entry point rather than reporting a broken machine. */
	test("a missing comdlg32 entry point is named", async () => {
		const fake = fakeDialogShim({ status: DIALOG_STATUS.missing, missing: "comdlg32.dll" });
		const { adapter: native } = adapter(fake);
		await expect(native.pickOpen({})).rejects.toThrow(
			/comdlg32\.dll did not resolve/,
		);
	});

	/** A real comdlg32 refusal carries its code, which is what separates it from a cancel. */
	test("a refused panel reports CommDlgExtendedError as hex", async () => {
		const fake = fakeDialogShim({ status: DIALOG_STATUS.refused, error: 0x3003 });
		const { adapter: native } = adapter(fake);
		await expect(native.pickOpen({})).rejects.toThrow(/0x00003003/);
	});

	test("a pick that answers no path is malformed, never an empty success", async () => {
		const { adapter: native } = adapter(fakeDialogShim({ paths: [] }));
		await expect(native.pickOpen({})).rejects.toThrow(/outside 1…16/);
	});

	test("no started platform is a named refusal, not a null call", async () => {
		const native = windowsDialogAdapter({ shim: () => undefined });
		await expect(native.pickOpen({})).rejects.toThrow(/needs a started Windows platform/);
	});
});

describe("dialog.savePanel on Windows", () => {
	test("hands C the suggested name and the filters", async () => {
		const { fake, adapter: native } = adapter(fakeDialogShim({ paths: ["C:\\notes\\a.md"] }));
		const result = await native.pickSave({
			title: "Save note",
			suggestedName: "a.md",
			filters: [{ name: "Markdown", extensions: ["md"] }],
		});
		expect(fake.calls).toEqual([`save:Save note:a.md:Markdown|*.md:${WINDOW}`]);
		expect(result).toEqual({ paths: ["C:\\notes\\a.md"] });
	});

	test("a cancelled save resolves an empty list", async () => {
		const { adapter: native } = adapter(fakeDialogShim({ status: DIALOG_STATUS.cancelled }));
		expect(await native.pickSave({ suggestedName: "a.md" })).toEqual({ paths: [] });
	});
});

describe("the filter spec", () => {
	test("is the NUL-free form C splits into name and pattern", () => {
		expect(filterSpec([{ name: "Text", extensions: ["txt", "*.md"] }])).toBe("Text|*.txt;*.md");
	});

	test("an extension with no pattern is dropped, so no filter matches everything", () => {
		expect(filterSpec([{ name: "Nothing", extensions: ["", "."] }])).toBe("");
	});

	test("no filters is no filter string at all", () => {
		expect(filterSpec(undefined)).toBe("");
	});
});

describe("dialog.cancel on Windows", () => {
	/**
	 * The modal owns the thread, so no JavaScript can run while the panel is up: there is never
	 * anything pending to end, and this is the honest answer rather than a refusal.
	 */
	test("answers cancelled:false, because nothing can be pending", async () => {
		const { adapter: native } = adapter();
		expect(await native.cancel()).toEqual({ cancelled: false, paths: [] });
	});
});

describe("the plugin wiring", () => {
	test("a pick through createDialogPlugin answers paths, not not-implemented", async () => {
		const { adapter: native } = adapter(fakeDialogShim({ paths: ["C:\\one.txt"] }));
		const plugin = createDialogPlugin(native);
		expect(await plugin.commands.openPanel({ title: "x" })).toEqual({
			paths: ["C:\\one.txt"],
		});
	});
});
