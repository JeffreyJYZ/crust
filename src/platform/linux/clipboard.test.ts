/**
 * The Linux clipboard, driven through a fake symbol table: no GTK exists on this machine, so what is
 * proved is the two-pass read, the verdicts and the refusals — not GDK.
 *
 * The two states a page must be able to tell apart are both here: an empty clipboard answers `""`,
 * and a GTK without the entry points is a failure naming `libgtk-3.so.0`, never an empty string.
 */
import { describe, expect, test } from "bun:test";
import { createClipboardPlugin } from "@/plugins/clipboard";
import { READ_CHUNK, linuxClipboardAdapter } from "./clipboard.ts";
import { fakeCoreShim } from "./core-fake.ts";

/** An adapter over a fake symbol table, with every answer stated by the test. */
function adapter(options = {}) {
	return linuxClipboardAdapter(() => fakeCoreShim(options));
}

describe("clipboard.read on Linux", () => {
	test("answers the text the selection holds", () => {
		expect(adapter({ clipboard: "copied on linux" }).readText()).toBe("copied on linux");
	});

	test("an empty selection is the empty string, not a failure", () => {
		expect(adapter().readText()).toBe("");
	});

	test("a copy longer than the first buffer is re-read at its exact size", () => {
		const long = "y".repeat(READ_CHUNK + 10);
		expect(adapter({ clipboard: long }).readText()).toBe(long);
	});

	test("no clipboard to read is refused by name, not answered empty", () => {
		expect(() => adapter({ clipboardRead: -1 }).readText()).toThrow("gtk_clipboard_get");
	});

	test("a GTK without the entry points names the library", () => {
		const broken = adapter({
			clipboardReady: 0,
			errorText: "missing symbol gtk_clipboard_get",
		});
		expect(() => broken.readText()).toThrow("libgtk-3.so.0");
		expect(() => broken.readText()).toThrow("gtk_clipboard_get");
	});
});

describe("clipboard.write on Linux", () => {
	test("answers written when GTK took the request", () => {
		expect(adapter().writeText("hello")).toBe("written");
	});

	test("no clipboard to write to throws rather than claiming a write", () => {
		expect(() => adapter({ clipboardWrite: -1 }).writeText("hello")).toThrow(
			"gtk_clipboard_get",
		);
	});
});

describe("the image half, which the GTK shim does not carry", () => {
	test("readImage refuses by name instead of answering no image", () => {
		expect(() => adapter().readImage()).toThrow("GdkPixbuf");
	});

	test("writeImage refuses by name instead of pretending it wrote", () => {
		expect(() => adapter().writeImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow(
			"GdkPixbuf",
		);
	});
});

describe("through the plugin, which is what a page sees", () => {
	test("read and write answer ok on a healthy clipboard", () => {
		const plugin = createClipboardPlugin(adapter({ clipboard: "shared" }));
		expect(plugin.commands.read({})).toEqual({ ok: true, text: "shared" });
		expect(plugin.commands.write({ text: "shared" })).toEqual({ ok: true, written: true });
	});

	test("a machine with no GTK names GTK, never NSPasteboard", () => {
		const plugin = createClipboardPlugin(adapter({ clipboardReady: 0 }));
		const answer = plugin.commands.read({});
		expect(answer).toMatchObject({ ok: false, code: "handler-error" });
		const message = "message" in answer ? answer.message : "";
		expect(message).toContain("libgtk-3.so.0");
		expect(message).not.toContain("NSPasteboard");
	});
});
