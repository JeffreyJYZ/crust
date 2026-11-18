/**
 * The dialog part's native contract, read from its own source: the entry points it resolves are the
 * ones the FFI table declares, they are resolved optionally, and it never takes the blocking path.
 *
 * There is no GTK on this machine, so the C unit cannot run here. What can be pinned is the shape the
 * JavaScript side depends on: a symbol resolved but not declared is a call bun:ffi refuses, a symbol
 * resolved mandatorily turns an old GTK into a launch failure, and `gtk_native_dialog_run` would
 * freeze every timer while the panel is up.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SHIM_PART_NAMES } from "./index.ts";

const DIR = import.meta.dir;
/** Both parts: the entry points and the answer state in `83`, the calls in `84`. */
const PART = ["83_dialog.c", "84_dialog_calls.c"]
	.map((name) => readFileSync(join(DIR, "shim", name), "utf8"))
	.join("\n");
const FFI = readFileSync(join(DIR, "shim-symbols.ts"), "utf8");

/** Every `shim_sym_or_null(gtk, "name"` the part resolves, in source order. */
function resolved(): string[] {
	return [...PART.matchAll(/shim_dlg_bind\(gtk, "([a-z_]+)"/g)].map((match) => match[1] ?? "");
}

describe("the dialog part's entry points", () => {
	test("is assembled into the unit", () => {
		expect(SHIM_PART_NAMES).toContain("83_dialog.c");
		expect(SHIM_PART_NAMES).toContain("84_dialog_calls.c");
	});

	test("resolves a named list rather than an anonymous one", () => {
		const names = resolved();
		expect(names.length).toBeGreaterThanOrEqual(14);
		for (const required of [
			"gtk_file_chooser_native_new",
			"gtk_native_dialog_show",
			"gtk_native_dialog_hide",
			"gtk_native_dialog_destroy",
			"gtk_file_chooser_get_filenames",
			"gtk_file_filter_add_pattern",
			"g_signal_connect_data",
			"g_free",
			"g_slist_free",
		]) {
			expect(names).toContain(required);
		}
	});

	/**
	 * Optional, never mandatory: GtkFileChooserNative is GTK 3.20, and a machine with an older GTK
	 * must still launch an app — the same rule the window API part follows.
	 */
	test("resolves every entry point optionally, so an old GTK still launches", () => {
		expect(PART).toContain("shim_sym_or_null(gtk, name)");
		expect(PART).not.toContain("shim_sym(gtk");
	});

	/** `gtk_native_dialog_run` would run a nested loop and block the pump the page depends on. */
	test("never takes the blocking run path", () => {
		expect(resolved()).not.toContain("gtk_native_dialog_run");
		expect(resolved()).not.toContain("gtk_dialog_run");
		expect(PART).toContain("shim_dlg_show(g_dlg_dialog)");
	});

	/** Destroying a dialog inside its own response handler is what GTK forbids. */
	test("the response handler records the answer and never destroys the dialog", () => {
		const start = PART.indexOf("static void shim_dlg_response(");
		expect(start).toBeGreaterThan(-1);
		const body = PART.slice(start, PART.indexOf("\n}", start));
		expect(body).toContain("shim_dlg_collect(dialog)");
		expect(body).not.toContain("shim_dlg_destroy");
	});

	/**
	 * The exports JavaScript calls: every one is in the `cc()` map (or the call is `undefined`), and
	 * every one has a definition in the part (or the link fails). The GTK entry points above are
	 * C-side only and deliberately absent from that map.
	 */
	test("every export the adapter calls is declared and defined", () => {
		for (const name of [
			"shim_dialog_ready",
			"shim_dialog_missing",
			"shim_dialog_open",
			"shim_dialog_save",
			"shim_dialog_status",
			"shim_dialog_count",
			"shim_dialog_path",
			"shim_dialog_cancel",
			"shim_dialog_release",
		]) {
			expect({ [name]: FFI.includes(`${name}: {`) }).toEqual({ [name]: true });
			expect({ [name]: PART.includes(`${name}(`) }).toEqual({ [name]: true });
		}
		expect(FFI).toContain("shim_dialog_open: { args: [CS, CS, I32, I32, P], returns: I32 }");
		expect(FFI).toContain("shim_dialog_save: { args: [CS, CS, CS, P], returns: I32 }");
	});
});
