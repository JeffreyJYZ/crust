/**
 * Stub Objective-C/CF runtime for the ownership audit. It compiles the REAL C units
 * with the audit prelude and -DCRUST_SHIM_AUDIT, but answers their sends with a fake
 * runtime: no AppKit, no window, no focus, no screenshot. The counting wrappers are
 * the product's own, so a missing release is the same defect in a test and in an app.
 */

import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditSource } from "./shim-audit.ts";

const DARWIN = import.meta.dir;
/** `shim/*.c` for the window shim, `status_bar/*.c` for the tray unit. */
const partPath = (name: string): string =>
	join(DARWIN, name.startsWith("status_bar/") ? name : join("shim", name));

export const STATUS_BAR_PARTS = [
	"status_bar/00_prelude.c",
	"status_bar/10_guards.c",
	"status_bar/20_target.c",
	"status_bar/30_item.c",
	"status_bar/40_readback.c",
	"status_bar/50_menu.c",
	"status_bar/60_teardown.c",
];

/** One stub, shared by every unit: selectors are integers, objects are small ids. */
export const STUB = `
#include <string.h>
static const char *sel_names[256];
static int sel_count, object_ids;
void *kCFBooleanTrue = (void *)3;
static char stub_utf8[] = "stub";
static int stub_menu;
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
	if (!strcmp(name, "alloc") || !strcmp(name, "new")) return (void *)(long)(++object_ids);
	if (!strncmp(name, "init", 4)) return self;
	if (!strcmp(name, "respondsToSelector:")) return (void *)1;
	if (!strcmp(name, "setMenu:")) { stub_menu = 1; return 0; }
	if (!strcmp(name, "menu")) return (void *)(long)(stub_menu ? 1001 : 0);
	if (!strcmp(name, "numberOfItems") || !strcmp(name, "tag")) return (void *)1;
	if (!strcmp(name, "UTF8String")) return stub_utf8;
	if (!strcmp(name, "sendAction:to:from:")) return (void *)1;
	if (!strcmp(name, "addItemWithTitle:action:keyEquivalent:") ||
	    !strcmp(name, "separatorItem") || !strcmp(name, "statusItemWithLength:"))
		return (void *)(long)(++object_ids);
	if (!strcmp(name, "length")) return (void *)10;
	return self ? (void *)1000 : 0;
}
void *class_getInstanceMethod(void *cls, void *sel) { (void)cls; (void)sel; return (void *)1; }
void *class_getClassMethod(void *cls, void *sel) { (void)cls; (void)sel; return (void *)1; }
void *object_getClass(void *obj) { (void)obj; return (void *)1; }
const char *class_getName(void *cls) { (void)cls; return "Stub"; }
void *objc_allocateClassPair(void *super, const char *name, unsigned long extra) {
	(void)super; (void)name; (void)extra; return (void *)2;
}
void objc_registerClassPair(void *cls) { (void)cls; }
void objc_disposeClassPair(void *cls) { (void)cls; }
int class_addMethod(void *cls, void *name, void *imp, const char *types) {
	(void)cls; (void)name; (void)imp; (void)types; return 1;
}
int NSApplicationLoad(void) { return 1; }
int CFRunLoopRunInMode(void *mode, double seconds, int stop) { (void)mode; (void)seconds; (void)stop; return 0; }
void *CFRunLoopGetMain(void) { return (void *)1; }
void *CFRunLoopGetCurrent(void) { return (void *)1; }
void *__CFStringMakeConstantString(const char *text) { return (void *)text; }
int CFStringGetCString(void *s, char *buf, long size, unsigned int encoding) {
	(void)s; (void)encoding; if (size > 0) buf[0] = 0; return 1;
}
void CFRetain(void *object) { (void)object; }
void CFRelease(void *object) { (void)object; }
void *CFDictionaryCreate(void *alloc, const void **keys, const void **values, long count,
                         const void *kc, const void *vc) {
	(void)alloc; (void)keys; (void)values; (void)count; (void)kc; (void)vc;
	return (void *)(long)(++object_ids);
}
long CFArrayGetCount(void *array) { (void)array; return 0; }
void *CFArrayGetValueAtIndex(void *array, long index) { (void)array; (void)index; return 0; }
void *AXUIElementCreateApplication(int pid) { (void)pid; return (void *)(long)(++object_ids); }
int AXUIElementCopyAttributeValue(void *element, void *attribute, void **value) {
	(void)element; (void)attribute; (void)value; return 0;
}
int AXUIElementSetAttributeValue(void *element, void *attribute, void *value) {
	(void)element; (void)attribute; (void)value; return 0;
}
void NSAccessibilityPostNotificationWithUserInfo(void *element, void *note, void *info) {
	(void)element; (void)note; (void)info;
}
`;

export type AuditUnit = Record<string, (...args: number[]) => number>;

/**
 * Compile the named C parts with the prelude, the stub, and a caller's driver.
 * Every library has its own counter, so each unit reports its own balance.
 */
export function compileAuditUnit(
	parts: string[],
	driver: string,
	drivers: string[],
	patch?: (name: string, source: string) => string,
): AuditUnit {
	const body = parts
		.map((name) => {
			const source = readFileSync(partPath(name), "utf8");
			return patch ? patch(name, source) : source;
		})
		.join("\n");
	const source = auditSource(`${STUB}\n${body}\n${driver}`);
	const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
	const file = join(tmpdir(), `crust-audit-${hash}.c`);
	if (!existsSync(file)) writeFileSync(file, source);
	const map: Record<string, { args: FFIType[]; returns: FFIType }> = {};
	for (const name of drivers) map[name] = { args: [], returns: FFIType.i32 };
	map.shim_audit_balance = { args: [], returns: FFIType.i32 };
	map.shim_audit_events = { args: [], returns: FFIType.i32 };
	map.shim_audit_reset = { args: [], returns: FFIType.void };
	map.shim_audit_bump = { args: [FFIType.i32], returns: FFIType.void };
	return cc({ source: file, flags: ["-DCRUST_SHIM_AUDIT"], symbols: map })
		.symbols as unknown as AuditUnit;
}
