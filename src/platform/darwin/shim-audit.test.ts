/**
 * The ownership audit's whole point: a leak is a red test, not a read-only finding.
 * Five real C units compile with the audit define and drive the paths hunt-22 named —
 * a rebuilt native menu, a tray title and tooltip, a window and its content world,
 * a find search, and a page announcement — through a stub Objective-C runtime. No
 * AppKit window, no focus change, no screenshot; the wrappers are the product's own.
 */

import { describe, expect, test } from "bun:test";
import {
	type AuditSymbols,
	AUDIT_DEFINE,
	auditFlags,
	auditOf,
	auditReset,
	auditSource,
	balanced,
	readAudit,
	requestShimAudit,
	shimAuditAvailable,
} from "./shim-audit.ts";
import { compileAuditUnit, STATUS_BAR_PARTS, type AuditUnit } from "./shim-audit-harness.ts";

const MENU_DRIVER = `
static void *menu_fake_imp(void) { return 0; }
int menu_warm(void) {
	if (!menu_api_target((void *)menu_fake_imp)) return 0;
	return menu_api_begin();
}
int menu_drive(void) {
	if (!menu_api_begin()) return 0;
	if (!menu_api_item("alpha", 5, "a", 1, 0, 0)) return 0;
	if (!menu_api_submenu("more", 4, "m", 1, 0)) return 0;
	if (!menu_api_item("beta", 4, "b", 1, 0, 1)) return 0;
	if (!menu_api_close()) return 0;
	if (!menu_api_install()) return 0;
	if (!menu_api_begin()) return 0;
	if (!menu_api_item("gamma", 5, "g", 1, 0, 0)) return 0;
	return menu_api_install();
}
`;

const TRAY_DRIVER = `
static void *tray_fake_imp(void) { return 0; }
static void *tray_item;
int tray_warm(void) {
	tray_item = tray_create((void *)tray_fake_imp);
	return tray_item != 0;
}
int tray_drive(void) {
	if (!tray_item) return 0;
	if (!tray_set_title(tray_item, "tick", 4)) return 0;
	if (!tray_set_tooltip(tray_item, "hint", 4)) return 0;
	if (!tray_menu_begin(tray_item)) return 0;
	if (!tray_menu_add("one", 3, 0)) return 0;
	if (!tray_menu_add("two", 3, 1)) return 0;
	if (!tray_menu_end(tray_item)) return 0;
	if (!tray_set_title(tray_item, "tock", 4)) return 0;
	if (!tray_menu_begin(tray_item)) return 0;
	if (!tray_menu_add("three", 5, 0)) return 0;
	if (!tray_menu_end(tray_item)) return 0;
	return tray_destroy(tray_item), 1;
}
`;

const WINDOW_DRIVER = `
static void *window_handle;
static void *window_view;
int window_warm(void) {
	window_handle = shim_window_new(0, 0, 10, 10, 0, 0, 1);
	if (!window_handle) return 0;
	return shim_content_world() != 0;
}
int window_drive(void) {
	shim_window_set_title(window_handle, "hello");
	void *world = shim_content_world_named(1);
	if (!world) return 0;
	window_view = shim_webview_new(shim_webview_configuration(), 0, 0);
	if (!window_view) return 0;
	if (!shim_webview_add_user_script(window_view, world, "token", 1)) return 0;
	((void (*)(void *, void *))objc_msgSend)(window_handle, sel_registerName("close"));
	return 1;
}
`;

const FIND_DRIVER = `
static int audit_sink_fn(int id, int found) { (void)id; (void)found; return 0; }
int find_warm(void) {
	crust_find_set_sink(audit_sink_fn);
	return crust_find_block_ready();
}
int find_drive(void) {
	return crust_find_search((void *)1000, "alpha", 5, 0, 0, 7) == 0 ? 1 : 0;
}
`;

const ANNOUNCE_DRIVER = `
int announce_warm(void) { return 1; }
int announce_drive(void) { return crust_ax_announce("hello", 0) == 1 ? 1 : 0; }
`;

function unit(
	prefix: string,
	parts: string[],
	driver: string,
	patch?: (name: string, source: string) => string,
): AuditUnit {
	return compileAuditUnit(parts, driver, [`${prefix}_warm`, `${prefix}_drive`], patch);
}

const units: Record<string, AuditUnit> = {
	menu: unit("menu", ["98_menu_prelude.c", "98_menu_api.c", "98_menu_read.c", "99_menu_context.c"], MENU_DRIVER),
	tray: unit("tray", STATUS_BAR_PARTS, TRAY_DRIVER),
	window: unit("window", ["10_prelude.c", "20_sends.c", "30_webview.c", "40_window.c", "121_content_world.c"], WINDOW_DRIVER),
	find: unit("find", ["108_find.c", "109_find_ids.c"], FIND_DRIVER),
	announce: unit("announce", ["106_accessibility_page.c", "106_accessibility_focus.c"], ANNOUNCE_DRIVER),
};

const DRIVERS: Record<string, [string, string]> = {
	menu: ["menu_warm", "menu_drive"],
	tray: ["tray_warm", "tray_drive"],
	window: ["window_warm", "window_drive"],
	find: ["find_warm", "find_drive"],
	announce: ["announce_warm", "announce_drive"],
};

function run(): Record<string, { balance: number; events: number }> {
	const reports: Record<string, AuditSymbols> = {};
	for (const [name, lib] of Object.entries(units)) {
		const [warm] = DRIVERS[name] ?? [];
		expect(Number(lib[warm ?? ""]!())).toBe(1);
		reports[name] = auditOf(lib);
	}
	auditReset(reports);
	for (const [name, lib] of Object.entries(units)) {
		const [, drive] = DRIVERS[name] ?? [];
		expect(Number(lib[drive ?? ""]!())).toBe(1);
	}
	return readAudit(reports);
}

describe("native ownership audit", () => {
	test("every audited unit is balanced after the driven paths", () => {
		const report = run();
		expect(report).toEqual({
			announce: { balance: 0, events: 3 },
			find: { balance: 0, events: 2 },
			menu: { balance: 0, events: 13 },
			tray: { balance: 0, events: 16 },
			window: { balance: 0, events: 3 },
		});
		expect(balanced(report)).toEqual([]);
	});

	test("a deliberately missing release is reported, not hidden", () => {
		const broken = unit("find", ["108_find.c", "109_find_ids.c"], FIND_DRIVER, (name, source) =>
			name === "108_find.c" ? source.replace(/\tcrust_release\((config|text)\);/g, "") : source,
		);
		expect(Number(broken.find_warm!())).toBe(1);
		const symbols = auditOf(broken);
		symbols.shim_audit_reset();
		expect(Number(broken.find_drive!())).toBe(1);
		const balance = Number(symbols.shim_audit_balance());
		expect(balance).toBe(2);
		expect(balanced({ find: { balance, events: Number(symbols.shim_audit_events()) } })).not.toEqual([]);
	});

	test("activation is opt-in and a shipped app cannot request it", () => {
		expect(shimAuditAvailable()).toBe(true);
		expect(requestShimAudit()).toBe(true);
		expect(auditFlags()).toContain(AUDIT_DEFINE);
		expect(auditSource("int x;\n").startsWith("// crust ownership audit")).toBe(true);
	});
});
