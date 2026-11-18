/**
 * The Windows clipboard, driven through the fake shim: no Win32 symbol can run on this machine, so
 * what is proved is the two-pass read, the verdicts and the refusals — not user32.
 *
 * The two states a page must be able to tell apart are both here: an empty clipboard answers `""`,
 * and a clipboard that could not be opened is a failure naming `OpenClipboard`, never an empty
 * string that reads as "nothing was copied".
 */
import { describe, expect, test } from "bun:test";
import { createClipboardPlugin } from "@/plugins/clipboard";
import { NO_WINDOWS_SHIM } from "./active-shim.ts";
import { READ_CHUNK, windowsClipboardAdapter } from "./clipboard.ts";
import type { FakeOptions } from "./fake-backend.ts";
import { fakeShim } from "./fake-shim.ts";

/** An adapter over a fake shim, with every answer stated by the test. */
function adapter(options: FakeOptions = {}) {
	return windowsClipboardAdapter(() => fakeShim(options));
}

describe("clipboard.read on Windows", () => {
	test("answers the text the clipboard holds", () => {
		expect(adapter({ clipboard: "copied on windows" }).readText()).toBe("copied on windows");
	});

	test("an empty clipboard is the empty string, not a failure", () => {
		expect(adapter().readText()).toBe("");
	});

	test("a copy longer than the first buffer is re-read at its exact size", () => {
		const long = "x".repeat(READ_CHUNK + 10);
		expect(adapter({ clipboard: long }).readText()).toBe(long);
	});

	test("a clipboard that could not be opened names OpenClipboard", () => {
		expect(() => adapter({ clipboardRead: -1 }).readText()).toThrow("OpenClipboard refused");
	});

	test("entry points that did not resolve are refused by name", () => {
		expect(() => adapter({ clipboardReady: 0 }).readText()).toThrow("did not resolve");
	});
});

describe("clipboard.write on Windows", () => {
	test("answers written when SetClipboardData took the text", () => {
		expect(adapter().writeText("hello")).toBe("written");
	});

	test("answers refused when the clipboard refused it", () => {
		expect(adapter({ clipboardWrite: 0 }).writeText("hello")).toBe("refused");
	});

	test("a clipboard that could not be opened throws rather than claiming a write", () => {
		expect(() => adapter({ clipboardWrite: -1 }).writeText("hello")).toThrow();
	});
});

describe("the image half, which the Win32 shim does not carry", () => {
	test("readImage refuses by name instead of answering no image", () => {
		expect(() => adapter().readImage()).toThrow("CF_DIBV5");
	});

	test("writeImage refuses by name instead of pretending it wrote", () => {
		expect(() => adapter().writeImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow(
			"CF_DIBV5",
		);
	});
});

describe("through the plugin, which is what a page sees", () => {
	test("read and write answer ok on a healthy clipboard", () => {
		const plugin = createClipboardPlugin(adapter({ clipboard: "shared" }));
		expect(plugin.commands.read({})).toEqual({ ok: true, text: "shared" });
		expect(plugin.commands.write({ text: "shared" })).toEqual({ ok: true, written: true });
	});

	test("no attached platform is a handler-error naming Win32, not a missing pasteboard", () => {
		const plugin = createClipboardPlugin(windowsClipboardAdapter(() => undefined));
		const answer = plugin.commands.read({});
		expect(answer).toMatchObject({ ok: false, code: "handler-error" });
		const message = "message" in answer ? answer.message : "";
		expect(message).toContain("no Windows platform is attached");
		expect(message).toBe(NO_WINDOWS_SHIM);
		expect(message).not.toContain("NSPasteboard");
	});

	test("an image refusal reaches the page as a reason, never as an empty result", () => {
		const answer = createClipboardPlugin(adapter()).commands.readImage();
		expect(answer).toMatchObject({ ok: false, code: "handler-error" });
	});
});
