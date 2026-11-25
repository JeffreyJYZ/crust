/**
 * The status-bar unit against a stub Objective-C runtime that counts -release. Every NSString,
 * menu row and rebuilt menu tree must be balanced or a clock in the menu bar grows the heap for the
 * life of the process. No AppKit window, no focus, no screenshot.
 */

import { describe, expect, test } from "bun:test";

import { auditSource } from "./shim-audit.ts";
import { probeWith } from "./ownership-harness";

const STUB = `
#include <string.h>
static const char *sel_names[128];
static int sel_count, release_calls, alloc_calls, object_ids;
static const char title_text[] = "row";
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
	if (!strcmp(name, "alloc")) { alloc_calls++; return (void *)(long)(++object_ids + 1000); }
	if (!strcmp(name, "release")) { release_calls++; return 0; }
	if (!strcmp(name, "initWithBytes:length:encoding:")) return (void *)(long)(++object_ids + 2000);
	if (!strcmp(name, "initWithTitle:")) return (void *)(long)(++object_ids + 3000);
	if (!strcmp(name, "initWithTitle:action:keyEquivalent:")) return (void *)(long)(++object_ids + 4000);
	if (!strcmp(name, "UTF8String")) return (void *)title_text;
	return (void*)1;
}
void *class_getInstanceMethod(void *cls, void *sel) { (void)cls; (void)sel; return (void *)1; }
void *class_getClassMethod(void *cls, void *sel) { (void)cls; (void)sel; return (void *)1; }
const char *class_getName(void *cls) { (void)cls; return "Stub"; }
void *objc_allocateClassPair(void *super, const char *name, unsigned long extra) {
	(void)super; (void)name; (void)extra; return (void *)2;
}
void objc_registerClassPair(void *cls) { (void)cls; }
int class_addMethod(void *cls, void *name, void *imp, const char *types) {
	(void)cls; (void)name; (void)imp; (void)types; return 1;
}
`;

const PARTS = [
	"../status_bar/00_prelude.c",
	"../status_bar/10_guards.c",
	"../status_bar/20_target.c",
	"../status_bar/30_item.c",
	"../status_bar/40_readback.c",
	"../status_bar/50_menu.c",
	"../status_bar/60_teardown.c",
];

describe("the status bar balances every +1 it hands to AppKit", () => {
	const titles = `
int test_titles(void) {
	release_calls = 0;
	tray_set_title((void *)1, "hello", 5);
	tray_set_tooltip((void *)1, "tip", 3);
	return release_calls;
}
`;
	test("a title and a tooltip each release their string", () => {
		expect(probeWith(auditSource(STUB), PARTS, titles, "test_titles")).toBe(2);
	});

	const rebuild = `
int test_rebuild(void) {
	tray_create((void *)7);
	release_calls = 0;
	tray_menu_begin((void *)1);
	tray_menu_add("Row", 3, 0);
	tray_menu_end((void *)1);
	tray_menu_begin((void *)1);
	tray_menu_add("Again", 5, 1);
	tray_menu_end((void *)1);
	return release_calls;
}
`;
	test("two menu builds release both trees: title+row per build plus each menu", () => {
		expect(probeWith(auditSource(STUB), PARTS, rebuild, "test_rebuild")).toBe(12);
	});
});
