/**
 * `menu.read` walks the live bar the app installed, not just the first two levels. A stub AppKit
 * holds File → Recent → leaf plus Edit; the flat readback must carry all four rows and the parent
 * index of every level. No window, no focus, no screenshot.
 */

import { cc, FFIType } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STUB = `
#include <string.h>
static const char *sel_names[128];
static int sel_count, item_calls;
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
	long object = (long)self;
	if (!strcmp(name, "respondsToSelector:")) return (void *)1;
	if (!strcmp(name, "sharedApplication")) return (void *)10;
	if (!strcmp(name, "mainMenu")) return (void *)20;
	if (!strcmp(name, "numberOfItems")) {
		if (object == 20) return (void *)2;
		if (object == 40 || object == 60) return (void *)1;
		return (void *)0;
	}
	if (!strcmp(name, "itemAtIndex:")) {
		item_calls++;
		if (item_calls == 1) return (void *)30;
		if (item_calls == 2) return (void *)50;
		if (item_calls == 3) return (void *)70;
		if (item_calls == 4) return (void *)80;
		return (void *)0;
	}
	if (!strcmp(name, "submenu")) {
		if (object == 30) return (void *)40;
		if (object == 50) return (void *)60;
		return (void *)0;
	}
	return (void *)1;
}
void *class_getInstanceMethod(void *cls, void *sel) { (void)cls; (void)sel; return (void *)1; }
`;

const MAIN = `
int test_depth(void) {
	item_calls = 0;
	int n = menu_api_read();
	if (n != 4) return -1;
	if (menu_api_read_parent(0) != -1) return -2;
	if (menu_api_read_parent(1) != 0) return -3;
	if (menu_api_read_parent(2) != 1) return -4;
	if (menu_api_read_parent(3) != -1) return -5;
	return 100 + n;
}
`;

describe("menu_api_read walks every level of the installed bar", () => {
	test("grandchild rows keep their parent index, so menu.read can rebuild the tree", () => {
		const dir = join(import.meta.dir, "shim");
		const body = [
			STUB,
			...["98_menu_prelude.c", "98_menu_api.c", "98_menu_read.c"].map((name) =>
				readFileSync(join(dir, name), "utf8"),
			),
			MAIN,
		].join("\n");
		const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
		const path = join(tmpdir(), `crust-menu-depth-${hash}.c`);
		if (!existsSync(path)) writeFileSync(path, body);
		const lib = cc({
			source: path,
			symbols: { test_depth: { args: [], returns: FFIType.i32 } },
		});
		const answer = Number(
			(lib.symbols as unknown as Record<string, () => number>).test_depth?.() ?? -99999,
		);
		expect(answer).toBe(104);
	});
});
