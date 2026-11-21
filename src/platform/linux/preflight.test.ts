import { describe, expect, test } from "bun:test";
import {
	INSTALL_LINE,
	LIBC_INSTALL_LINE,
	LIBC_PKG,
	linkError,
	PREFLIGHT,
	preflightError,
	preflightErrors,
} from "./index.ts";

const [gtk] = PREFLIGHT;
const [, webkit] = PREFLIGHT;
if (!gtk || !webkit) throw new Error("PREFLIGHT must name both libraries");

describe("PREFLIGHT", () => {
	test("names the GTK3 and WebKitGTK 4.1 runtime objects", () => {
		expect([...new Set(PREFLIGHT.map((entry) => entry.library))]).toEqual([
			"libgtk-3.so.0",
			"libwebkit2gtk-4.1.so.0",
		]);
	});

	test("probes a symbol that proves the library, not only its file", () => {
		expect(gtk.symbol).toBe("gtk_init_check");
		expect(webkit.symbol).toBe("webkit_web_view_new");
	});

	// Each of these is resolved with `shim_sym` — mandatory at launch. A library
	// that exports the first two but not these used to pass the probe and fail
	// later with a bare "missing symbol" from C.
	test("covers every symbol the shim requires, not only the two library proofs", () => {
		const symbols = PREFLIGHT.map((entry) => entry.symbol);
		for (const required of [
			"gtk_init_check",
			"g_main_context_iteration",
			"webkit_web_view_new",
			"webkit_web_view_load_uri",
			"gtk_window_new",
			"gtk_window_set_title",
			"gtk_window_set_default_size",
			"gtk_widget_set_size_request",
			"gtk_container_add",
			"gtk_widget_show_all",
			"gtk_widget_destroy",
			"g_signal_connect_data",
			// The window's positioned container: required because the app's own webview lives in it.
			"gtk_overlay_new",
			"gtk_overlay_add_overlay",
			"gtk_widget_show",
			"gtk_widget_set_halign",
			"gtk_widget_set_valign",
			"gtk_widget_set_margin_start",
			"gtk_widget_set_margin_top",
			"gtk_widget_get_parent",
		]) {
			expect(symbols).toContain(required);
		}
		// Optional proof entries stay optional: launching an app must not require
		// `evaluate_javascript`, which arrived only in WebKitGTK 2.40.
		expect(symbols).not.toContain("webkit_web_view_evaluate_javascript");
	});

	test("a library with a partial symbol set fails preflight by that symbol's name", () => {
		const seen: string[] = [];
		const errors = preflightErrors((entry) => {
			seen.push(entry.symbol);
			return entry.symbol !== "g_main_context_iteration";
		});
		expect(seen).toContain("g_main_context_iteration");
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("g_main_context_iteration");
		expect(errors[0]).toContain("libgtk-3.so.0");
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

/**
 * The compiler-level dependency: `cc()` links libc, so the `libc.so` linker script from the C
 * development package is required even though GTK and WebKitGTK are `dlopen`ed. A Fedora user met
 * the raw `library c not found` on their first command, so these pin the package name in the text.
 */
describe("linkError", () => {
	test("TinyCC's missing libc message becomes the package that ships the linker script", () => {
		const text = linkError("library c not found") ?? "";
		expect(text).toContain("glibc-devel");
		expect(text).toContain("libc6-dev");
		expect(text).toContain("library c not found");
	});

	test("the install line names a package per family, with the tool that installs it", () => {
		expect(LIBC_PKG).toBe("glibc-devel");
		expect(LIBC_INSTALL_LINE).toContain("apt install libc6-dev");
		expect(LIBC_INSTALL_LINE).toContain("dnf install glibc-devel");
		expect(LIBC_INSTALL_LINE).toContain("zypper install glibc-devel");
	});

	test("the -lc wording from a direct tcc call is the same failure", () => {
		expect(linkError("tcc: error: unable to find library -lc")).toContain("glibc-devel");
	});

	test("says why GTK and WebKitGTK need no devel package", () => {
		expect(linkError("library c not found")).toContain("dlopen");
	});

	test("a genuine C error keeps its own text and names no package", () => {
		expect(linkError("shim.c:41: error: 'gtk_widget' undeclared")).toBeUndefined();
	});
});
