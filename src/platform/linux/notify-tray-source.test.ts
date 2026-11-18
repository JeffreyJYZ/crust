/**
 * What the Linux notification + tray C unit says about itself, read off its own source.
 *
 * Read-from-code claims, not measurements: nothing here runs libnotify or GTK. What they do prove is
 * that the unit stays dlopen-only (no `#include`, nothing linked beyond libc), that it never hands a
 * GLib block to Bun's allocator, and that no entry point is resolved without a preflight row.
 */
import { describe, expect, test } from "bun:test";
import {
	LIBGTK,
	LIBNOTIFY,
	NOTIFY_TRAY_INSTALL_LINE,
	NOTIFY_TRAY_PREFLIGHT,
} from "./notify-tray-ffi.ts";
import {
	NOTIFY_TRAY_PART_NAMES,
	NOTIFY_TRAY_PART_PATHS,
	NOTIFY_TRAY_PARTS,
	notifyTraySource,
	readNotifyTrayPart,
} from "./notify-tray-source.ts";

const NOTIFY = readNotifyTrayPart("80_notify.c");
const TRAY = readNotifyTrayPart("81_tray.c");
const ALL = `${NOTIFY}\n${TRAY}`;
/** The same text with its `//` comment lines dropped, for the assertions about what the code calls. */
const CODE = ALL.split("\n")
	.filter((line) => !line.trim().startsWith("//"))
	.join("\n");

describe("the unit's parts", () => {
	test("two parts, in the order the shared statics need", () => {
		expect(NOTIFY_TRAY_PART_NAMES).toEqual(["80_notify.c", "81_tray.c"]);
		expect(NOTIFY_TRAY_PART_PATHS).toHaveLength(2);
		expect(NOTIFY_TRAY_PARTS).toHaveLength(2);
	});

	test("the embedded source is the two parts, joined", () => {
		expect(notifyTraySource).toBe(NOTIFY_TRAY_PARTS.join("\n"));
		expect(NOTIFY_TRAY_PARTS[0]).toBe(NOTIFY);
	});
});

describe("what the unit links", () => {
	/** `cc()` links only libc, so a header or a third import is a load-time fault on a real desktop. */
	test("no #include, and the only imports are the two that resolve", () => {
		// The comment lines above say "no #include" in prose, so the assertion reads code only.
		expect(CODE).not.toContain("#include");
		const externs = [...CODE.matchAll(/^extern .*?(\w+)\(/gm)].map((match) => match[1]);
		expect(externs).toEqual(["dlopen", "dlsym"]);
	});

	/** Bun exports its own allocator, so a GLib string handed to `free` faults (measured 2026-11-16). */
	test("never frees a GLib block with Bun's allocator", () => {
		expect(CODE).not.toContain("malloc");
		expect(CODE).not.toMatch(/[^_a-zA-Z]free\(/);
		expect(CODE).toContain("g_error_free(error)");
	});

	test("both libraries are opened by their runtime soname", () => {
		expect(NOTIFY).toContain(`dlopen("${LIBNOTIFY}"`);
		expect(TRAY).toContain(`dlopen("${LIBGTK}"`);
	});
});

describe("the mechanisms", () => {
	test("the notification goes through libnotify's synchronous show", () => {
		expect(NOTIFY).toContain("notify_notification_new(");
		expect(NOTIFY).toContain("notify_notification_show(note, &error)");
		// Synchronous: the daemon's own answer is the status, not this unit's optimism.
		expect(NOTIFY).toContain("g_notify_last = note;");
	});

	test("the tray is a GtkStatusIcon with a GtkMenu, opened at the pointer", () => {
		expect(TRAY).toContain("gtk_status_icon_new_from_icon_name(");
		expect(TRAY).toContain('"popup-menu"');
		expect(TRAY).toContain("gtk_menu_popup_at_pointer(g_menu, 0)");
		// No second main loop: the window shim already iterates the default context.
		expect(CODE).not.toContain("g_main_context_iteration");
	});

	test("the install line names the package a missing library needs", () => {
		expect(NOTIFY_TRAY_INSTALL_LINE).toContain("libnotify4");
		expect(NOTIFY_TRAY_INSTALL_LINE).toContain("libgtk-3-0");
	});
});

describe("the entry points the C resolves", () => {
	/**
	 * Every `shim_sym(g_handle, "name")` has a preflight row naming the same library, and every row
	 * names a symbol the C still resolves — a new call cannot arrive unclassified, and a deleted one
	 * cannot leave a stale remedy behind.
	 */
	test("are exactly the preflight table, library for library", () => {
		const handles: Record<string, string> = { notify: LIBNOTIFY, gtk: LIBGTK };
		const resolved = [...CODE.matchAll(/shim_sym\(g_(\w+), "(\w+)"/g)].map(
			(match) => `${handles[match[1] ?? ""] ?? match[1]}!${match[2]}`,
		);
		const listed = NOTIFY_TRAY_PREFLIGHT.map((entry) => `${entry.library}!${entry.symbol}`);
		expect(resolved.sort()).toEqual(listed.sort());
	});

	test("each one says what breaks without it, and which package ships it", () => {
		for (const entry of NOTIFY_TRAY_PREFLIGHT) {
			expect(entry.breaks.length).toBeGreaterThan(10);
			expect(entry.pkg.length).toBeGreaterThan(3);
		}
	});
});
