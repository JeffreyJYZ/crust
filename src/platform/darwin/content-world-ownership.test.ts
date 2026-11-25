/**
 * Evidence for the content-world fix, compiled against a stub Objective-C runtime that models the
 * pump's per-tick autorelease pool. `+worldWithName:` answers a +0 object; unless the shim owns a
 * retain, one tick frees the pointer it keeps in the static and the next window create sends a
 * message to freed memory. No live WebKit and no focus are involved.
 */

import { describe, expect, test } from "bun:test";

import { probeWith } from "./ownership-harness";

const STUB = `
#include <string.h>
static const char *sel_names[128];
static int sel_count, retain_calls, release_calls, world_refs, world_alive;
void *objc_getClass(const char *name) { (void)name; return (void *)1; }
void *sel_registerName(const char *name) {
	int i;
	for (i = 0; i < sel_count; i++) if (!strcmp(sel_names[i], name)) return (void *)(long)(i + 1);
	sel_names[sel_count] = name;
	return (void *)(long)(++sel_count);
}
long long shim_cstr_len(const char *p) { long n = 0; while (p && p[n]) n++; return n; }
void *objc_msgSend(void *self, void *sel, ...) {
	long id = (long)sel;
	const char *name = id > 0 && id <= sel_count ? sel_names[id - 1] : "";
	if (!strcmp(name, "alloc")) return (void *)100;
	if (!strcmp(name, "initWithBytes:length:encoding:")) return (void *)101;
	if (!strcmp(name, "worldWithName:")) { world_refs = 0; world_alive = 1; return (void *)200; }
	if (!strcmp(name, "retain")) {
		retain_calls++;
		if (self == (void *)200) world_refs++;
		return self;
	}
	if (!strcmp(name, "release")) {
		release_calls++;
		if (self == (void *)200 && --world_refs <= 0) world_alive = 0;
		return 0;
	}
	return (void *)300;
}
/* One pump tick: a +0 object with no owning reference dies when the pool drains. */
static void pool_drain(void) { if (world_refs <= 0) world_alive = 0; }
`;

const PARTS = ["10_prelude.c", "121_content_world.c"];

describe("the cached content world owns its reference", () => {
	const main = `
int test_content_world(void) {
	void *first = shim_content_world();
	if (!first) return -1;
	if (world_refs != 1) return -2;
	pool_drain();
	if (!world_alive) return -3;
	if (shim_content_world() != first) return -4;
	if (world_refs != 1) return -5;
	return 100 + release_calls;
}
`;
	test("one retain survives a pool drain; the name is released", () => {
		expect(probeWith(STUB, PARTS, main, "test_content_world")).toBe(101);
	});
});

describe("each user script balances its two +1 objects", () => {
	const main = `
int test_user_script(void) {
	release_calls = 0;
	if (!shim_webview_add_user_script((void *)1, (void *)200, "bridge", 1)) return -1;
	if (release_calls != 2) return -2;
	return 100 + release_calls;
}
`;
	test("text and WKUserScript are each released after addUserScript:", () => {
		expect(probeWith(STUB, PARTS, main, "test_user_script")).toBe(102);
	});
});
