/**
 * Shared C-compiling harness for the native ownership tests. The two C leaks Lane 10 measured
 * (docs/reviews/next-wave/native-surface.md §1 and §2) are proven by compiling the REAL shim
 * source against a stub Objective-C runtime and counting -release messages. A +1 object with no
 * matching release is the leak; a Cocoa object handed to free() is the other trap. Nothing here
 * touches a live WebKit or advapi32.
 */

import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = join(import.meta.dir, "shim");
export const read = (name: string) => readFileSync(join(DIR, name), "utf8");

/** A no-op Objective-C runtime: selectors are integers, objects are integers, release is counted. */
export const STUB = `
#include <string.h>
static const char *sel_names[128];
static int sel_count, release_calls, alloc_calls, object_ids;
char _NSConcreteGlobalBlock;
char _NSConcreteStackBlock;
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
	if (!strcmp(name, "release")) { release_calls++; return 0; }
	if (!strcmp(name, "alloc")) { alloc_calls++; return (void *)(long)(++object_ids); }
	if (!strcmp(name, "dictionary")) return (void *)(long)(++object_ids);
	return (void *)(long)1000;
}
void *objc_allocateClassPair(void *super, const char *name, unsigned long extra) {
	(void)super; (void)name; (void)extra; return (void *)2;
}
void objc_registerClassPair(void *cls) { (void)cls; }
void objc_disposeClassPair(void *cls) { (void)cls; }
int class_addMethod(void *cls, void *name, void *imp, const char *types) {
	(void)cls; (void)name; (void)imp; (void)types; return 1;
}
`;

/**
 * One class_addMethod fails, a duplicate class name cannot be reallocated until the pair is
 * disposed, and both are counted — the two halves of the wedge in native-surface.md §5.
 */
export const STUB_CLASS = `
#include <string.h>
static const char *sel_names[128];
static int sel_count, object_ids, fail_add, dispose_calls, allocate_calls, class_live;
char _NSConcreteGlobalBlock;
char _NSConcreteStackBlock;
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
	if (!strcmp(name, "alloc")) return (void *)(long)(++object_ids);
	return (void *)1000;
}
void *objc_allocateClassPair(void *super, const char *name, unsigned long extra) {
	(void)super; (void)name; (void)extra;
	allocate_calls++;
	if (class_live) return 0;
	class_live = 1;
	return (void *)2;
}
void objc_registerClassPair(void *cls) { (void)cls; }
void objc_disposeClassPair(void *cls) { (void)cls; dispose_calls++; class_live = 0; }
int class_addMethod(void *cls, void *name, void *imp, const char *types) {
	(void)cls; (void)name; (void)imp; (void)types;
	if (fail_add) { fail_add = 0; return 0; }
	return 1;
}
`;

/**
 * STUB_CLASS with a name-aware objc_getClass: only real framework classes resolve, so a pair that
 * was allocated but never registered is invisible to the lookup every installer starts with.
 * `fail_add_at` picks which class_addMethod (1-based) refuses, so every failure branch is drivable.
 */
export const STUB_CLASS_NAMED = `
#include <string.h>
static const char *sel_names[128];
static int sel_count, object_ids, fail_add_at, add_calls, dispose_calls, allocate_calls, class_live;
void *objc_getClass(const char *name) { return name && !strcmp(name, "NSObject") ? (void *)1 : 0; }
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
	return (void *)1000;
}
void *objc_allocateClassPair(void *super, const char *name, unsigned long extra) {
	(void)super; (void)name; (void)extra;
	allocate_calls++;
	if (class_live) return 0;
	class_live = 1;
	return (void *)2;
}
void objc_registerClassPair(void *cls) { (void)cls; }
void objc_disposeClassPair(void *cls) { (void)cls; dispose_calls++; class_live = 0; }
int class_addMethod(void *cls, void *name, void *imp, const char *types) {
	(void)cls; (void)name; (void)imp; (void)types;
	add_calls++;
	if (add_calls == fail_add_at) return 0;
	return 1;
}
`;

/** Compile a stub harness + the named shim parts, expose one probe, and call it. */
export function probeWith(stub: string, parts: string[], main: string, symbol: string): number {
	// Foundation exports the concrete block classes in the real build; the stub defines them, so drop
	// the shim's externs (TinyCC rejects a void object definition on this side).
	const body = parts
		.map(read)
		.join("\n")
		.replace(/extern void _NSConcrete(?:Global|Stack)Block;/g, "");
	const source = stub + "\n" + body + "\n" + main;
	const path = join(
		tmpdir(),
		`crust-ownership-${createHash("sha256").update(source).digest("hex").slice(0, 16)}.c`,
	);
	if (!existsSync(path)) writeFileSync(path, source);
	const lib = cc({
		source: path,
		symbols: { [symbol]: { args: [], returns: FFIType.i32 } },
	});
	return Number((lib.symbols as Record<string, () => number>)[symbol]?.() ?? -99999);
}

export const probe = (parts: string[], main: string, symbol: string) =>
	probeWith(STUB, parts, main, symbol);

export const NETWORK = ["110_network.c", "113_network_serve.c"];
export const DOWNLOADS = [
	"downloads/00_prelude.c",
	"downloads/10_block.c",
	"downloads/20_delegate.c",
	"downloads/30_api.c",
];
