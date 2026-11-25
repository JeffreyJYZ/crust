/**
 * The C half of `crust:testing`, compiled against a stub runtime. It proves the request id is
 * captured at send time: a newer evaluation cannot rewrite the id inside an older completion.
 * The test instrument copies each block at the point it is built — the same bytes WebKit's
 * `_Block_copy` keeps — and invokes the older copy after the newer request was sent.
 */

import { cc, FFIType } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const original = readFileSync(join(import.meta.dir, "testing-eval.c"), "utf8");
const SEAM = "\tblock.id = id;\n";
const instrumented = original.replace(
	SEAM,
	`${SEAM}\tif (te_probe_count < 4) te_probe[te_probe_count++] = *(struct te_probe_block *)&block;\n`,
);
if (instrumented === original) throw new Error("crust: the testing-eval capture seam moved");

const STUB = `
#include <string.h>
char _NSConcreteStackBlock;
static const char *sel_names[128];
static int sel_count, release_calls;
static const char result_text[] = "ok";
struct te_probe_block { void *isa; int flags; int reserved; void (*invoke)(void *, void *, void *); void *descriptor; long long id; };
static struct te_probe_block te_probe[4];
static int te_probe_count;
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
	if (!strcmp(name, "alloc")) return (void *)100;
	if (!strcmp(name, "initWithBytes:length:encoding:")) return (void *)101;
	if (!strcmp(name, "UTF8String")) return (void *)result_text;
	if (!strcmp(name, "release")) { release_calls++; return 0; }
	return (void *)1000;
}
static int last_kind = -1;
static long long last_id = -1;
static void record(int kind, const char *bytes, long long length, long long id) {
	(void)bytes; (void)length;
	last_kind = kind;
	last_id = id;
}
`;

function probe(main: string, symbol: string): number {
	// The stub defines the data symbol as a char; drop the shim's void extern as the shared
	// ownership harness does, or TinyCC rejects the incompatible redeclaration.
	const body = `${STUB}\n${instrumented.replace(/extern void _NSConcreteStackBlock;/g, "")}\n${main}`;
	const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
	const path = join(tmpdir(), `crust-te-ownership-${hash}.c`);
	if (!existsSync(path)) writeFileSync(path, body);
	const lib = cc({ source: path, symbols: { [symbol]: { args: [], returns: FFIType.i32 } } });
	return Number((lib.symbols as unknown as Record<string, () => number>)[symbol]?.() ?? -99999);
}

describe("a completion keeps the id captured at send time", () => {
	const main = `
int test_correlation(void) {
	crust_testing_set_sink(record);
	if (crust_testing_eval((void *)9, "a", 1, 1) != 0) return -1;
	if (crust_testing_eval((void *)9, "b", 1, 65) != 0) return -2;
	if (te_probe_count != 2) return -3;
	if (te_probe[0].id != 1 || te_probe[1].id != 65) return -4;
	last_kind = -1; last_id = -1;
	te_probe[0].invoke((void *)&te_probe[0], (void *)5000, 0);
	if (last_kind != 0 || last_id != 1) return -5;
	return 100 + last_id;
}
`;
	test("a late answer for id 1 never becomes id 65", () => {
		expect(probe(main, "test_correlation")).toBe(101);
	});
});

describe("the script string balances its +1", () => {
	const main = `
int test_release(void) {
	release_calls = 0;
	crust_testing_set_sink(record);
	if (crust_testing_eval((void *)9, "a", 1, 7) != 0) return -1;
	if (release_calls != 1) return -2;
	return 100 + release_calls;
}
`;
	test("evaluateJavaScript releases the NSString it built", () => {
		expect(probe(main, "test_release")).toBe(101);
	});
});
