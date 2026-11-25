/**
 * The two remaining hunt-22 ownership units compiled against stub runtimes that count -release.
 * A menu rebuild must drop the tree it replaces; an announcement and an accessible title must drop
 * the NSString each built. No AppKit window, no focus, no screenshot.
 */

import { cc, FFIType } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { auditSource } from "./shim-audit.ts";

const DIR = join(import.meta.dir, "shim");

function compile(stub: string, parts: string[], main: string, symbol: string): number {
	const body = auditSource(
		`${stub}\n${parts.map((name) => readFileSync(join(DIR, name), "utf8")).join("\n")}\n${main}`,
	);
	const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
	const path = join(tmpdir(), `crust-hunt22-ownership-${hash}.c`);
	if (!existsSync(path)) writeFileSync(path, body);
	const lib = cc({ source: path, symbols: { [symbol]: { args: [], returns: FFIType.i32 } } });
	return Number((lib.symbols as unknown as Record<string, () => number>)[symbol]?.() ?? -99999);
}

const OBJC = `
#include <string.h>
static const char *sel_names[128];
static int sel_count, release_calls, object_ids;
void *objc_getClass(const char *name) { (void)name; return (void *)1; }
void *sel_registerName(const char *name) {
	int i;
	for (i = 0; i < sel_count; i++) if (!strcmp(sel_names[i], name)) return (void *)(long)(i + 1);
	sel_names[sel_count] = name;
	return (void *)(long)(++sel_count);
}
void *objc_msgSend(void *self, void *sel, ...) {
	long id = (long)sel;
	const char *name = id > 0 && id <= sel_count ? sel_names[id - 1] : "";
	(void)self;
	if (!strcmp(name, "alloc")) return (void *)(long)(++object_ids + 1000);
	if (!strcmp(name, "release")) { release_calls++; return 0; }
	if (!strcmp(name, "UTF8String")) return (void *)"row";
	if (!strcmp(name, "initWithBytes:length:encoding:")) return (void *)(long)(++object_ids + 2000);
	if (!strcmp(name, "initWithTitle:")) return (void *)(long)(++object_ids + 3000);
	return (void *)1;
}
void *class_getInstanceMethod(void *cls, void *sel) { (void)cls; (void)sel; return (void *)1; }
const char *class_getName(void *cls) { (void)cls; return "Stub"; }
void *objc_allocateClassPair(void *super, const char *name, unsigned long extra) {
	(void)super; (void)name; (void)extra; return (void *)2;
}
void objc_registerClassPair(void *cls) { (void)cls; }
void objc_disposeClassPair(void *cls) { (void)cls; }
int class_addMethod(void *cls, void *name, void *imp, const char *types) {
	(void)cls; (void)name; (void)imp; (void)types; return 1;
}
`;

describe("the app menu balances its strings and rebuilt trees", () => {
	const main = `
int test_menu(void) {
	menu_api_target((void *)7);
	release_calls = 0;
	menu_api_begin();
	menu_api_item("A", 1, "", 0, 0, 0);
	menu_api_submenu("S", 1, "", 0, 0);
	menu_api_close();
	menu_api_install();
	/* begin: title+root, item: title+equivalent, submenu: title+equivalent+submenu,
	   close: submenu, install: root */
	return release_calls;
}
`;
	test("begin/item/submenu/close/install balance every +1", () => {
		expect(compile(OBJC, ["98_menu_prelude.c", "98_menu_api.c"], main, "test_menu")).toBe(6);
	});
});

const AX_STUB = `${OBJC}
void *kCFBooleanTrue = (void *)1;
void *__CFStringMakeConstantString(const char *s) { return (void *)s; }
void *CFDictionaryCreate(void *alloc, const void **keys, const void **values, long count,
                         const void *kc, const void *vc) {
	(void)alloc; (void)keys; (void)values; (void)count; (void)kc; (void)vc; return (void *)900;
}
void CFRelease(void *cf) { (void)cf; }
long CFArrayGetCount(void *array) { (void)array; return 1; }
void *CFArrayGetValueAtIndex(void *array, long index) { (void)array; (void)index; return (void *)902; }
void *AXUIElementCreateApplication(int pid) { (void)pid; return (void *)901; }
int AXUIElementCopyAttributeValue(void *element, void *attribute, void **value) {
	(void)element; (void)attribute; if (value) *value = (void *)903; return 0;
}
int ax_set_result;
int AXUIElementSetAttributeValue(void *element, void *attribute, void *value) {
	(void)element; (void)attribute; (void)value; return ax_set_result;
}
void NSAccessibilityPostNotificationWithUserInfo(void *element, void *name, void *info) {
	(void)element; (void)name; (void)info;
}
int getpid(void) { return 42; }
`;

describe("the accessibility page balances its Objective-C strings", () => {
	const main = `
int test_ax(void) {
	release_calls = 0;
	crust_ax_announce("hello", 1);
	crust_ax_title("label", "");
	return release_calls;
}
`;
	test("one announcement and one title release their strings", () => {
		expect(compile(AX_STUB, ["106_accessibility_page.c"], main, "test_ax")).toBe(2);
	});
});

describe("a matched AX window does not claim focus moved when AppKit refused the set", () => {
	const parts = ["106_accessibility_page.c", "106_accessibility_focus.c"];
	const refused = `
int test_focus_refused(void) {
	ax_set_result = -252;
	int answer = crust_ax_focus("");
	return answer == 2 ? 100 : answer;
}
`;
	const applied = `
int test_focus_applied(void) {
	ax_set_result = 0;
	int answer = crust_ax_focus("");
	return answer == 1 ? 100 : answer;
}
`;
	test("a refused AXUIElementSetAttributeValue reports 2, not success", () => {
		expect(compile(AX_STUB, parts, refused, "test_focus_refused")).toBe(100);
	});
	test("accepted sets and posts report 1", () => {
		expect(compile(AX_STUB, parts, applied, "test_focus_applied")).toBe(100);
	});
});
