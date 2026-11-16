import { describe, expect, test } from "bun:test";
import { INSTALL_LINE, PREFLIGHT, preflightError, preflightErrors } from "./index.ts";

const [gtk] = PREFLIGHT;
const [, webkit] = PREFLIGHT;
if (!gtk || !webkit) throw new Error("PREFLIGHT must name both libraries");

describe("PREFLIGHT", () => {
	test("names the GTK3 and WebKitGTK 4.1 runtime objects", () => {
		expect(PREFLIGHT.map((entry) => entry.library)).toEqual([
			"libgtk-3.so.0",
			"libwebkit2gtk-4.1.so.0",
		]);
	});

	test("probes a symbol that proves the library, not only its file", () => {
		expect(gtk.symbol).toBe("gtk_init_check");
		expect(webkit.symbol).toBe("webkit_web_view_new");
	});

	test("the install line names both package families", () => {
		expect(INSTALL_LINE).toContain("apt install");
		expect(INSTALL_LINE).toContain("dnf install");
	});
});

describe("preflightError", () => {
	test("a loadable library has no error", () => {
		expect(preflightError(gtk, () => true)).toBeUndefined();
	});

	test("a missing library returns the install line rather than throwing", () => {
		const error = preflightError(gtk, () => false);
		expect(error).toContain("libgtk-3.so.0");
		expect(error).toContain("gtk_init_check");
		expect(error).toContain("libgtk-3-0");
		expect(error).toContain("apt install");
		expect(error).toContain("dnf install");
	});

	test("a probe that throws is a missing library, never an escaping error", () => {
		const error = preflightError(webkit, () => {
			throw new Error("dlopen exploded");
		});
		expect(error).toContain("libwebkit2gtk-4.1.so.0");
		expect(error).toContain("webkit2gtk4.1");
	});

	test("preflightErrors reports every absent library in order", () => {
		expect(preflightErrors(() => true)).toEqual([]);
		const errors = preflightErrors(() => false);
		expect(errors).toHaveLength(PREFLIGHT.length);
		expect(errors[0]).toContain("libgtk-3.so.0");
		expect(errors[1]).toContain("libwebkit2gtk-4.1.so.0");
	});

	/**
	 * The real `dlopen` probe on this machine: macOS has neither library, so the
	 * answer must be text. It proves the default path is guarded and never throws,
	 * which is the one thing a probe without GTK can prove here.
	 */
	test.skipIf(process.platform === "linux")("the real probe reports the libraries absent", () => {
		expect(preflightError(gtk)).toContain("libgtk-3.so.0 not loadable");
		expect(preflightError(webkit)).toContain("libwebkit2gtk-4.1.so.0 not loadable");
	});
});
