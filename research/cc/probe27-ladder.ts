// probe27: signature ladder — which arities work through a fixed prototype, and what breaks
import { cc, FFIType } from "bun:ffi";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
const d = mkdtempSync(join(tmpdir(), "crust-p27-"));
const f = join(d, "ladder.c");
writeFileSync(f, `
#include <stdlib.h>
extern void *objc_getClass(const char *);
extern void *sel_registerName(const char *);
extern void *objc_allocateClassPair(void *, const char *, size_t);
int class_addMethod(void *, void *, void *, const char *);
extern void *objc_msgSend(void *, void *, ...);

static long got1 = -1, got2 = -1, got3 = -1, gotf = -1;

static long m1(void *s, void *sel, long a) { got1 = a; return a * 2; }
static long m2(void *s, void *sel, long a, long b) { got2 = a * 1000 + b; return a * 1000 + b; }
static long m3(void *s, void *sel, long a, long b, long c) { got3 = a * 1000000 + b * 1000 + c; return got3; }

void *make_class(void) {
  void *cls = objc_allocateClassPair((void *)objc_getClass("NSObject"), "CrustLadder", 0);
  if (!cls) return 0;
  class_addMethod(cls, sel_registerName("one:"), (void *)m1, "q@:q");
  class_addMethod(cls, sel_registerName("two:"), (void *)m2, "q@:qq");
  class_addMethod(cls, sel_registerName("three:"), (void *)m3, "q@:qqq");
  return cls;
}
void *new_instance(void *cls) {
  void *i = objc_msgSend(cls, sel_registerName("alloc"));
  return i ? objc_msgSend(i, sel_registerName("init")) : 0;
}

// fixed prototypes at increasing arity
long send1(void *i, long a) { return ((long (*)(void *, void *, long))objc_msgSend)(i, sel_registerName("one:"), a); }
long send2(void *i, long a, long b) { return ((long (*)(void *, void *, long, long))objc_msgSend)(i, sel_registerName("two:"), a, b); }
long send3(void *i, long a, long b, long c) { return ((long (*)(void *, void *, long, long, long))objc_msgSend)(i, sel_registerName("three:"), a, b, c); }

long seen1(void) { return got1; }
long seen2(void) { return got2; }
long seen3(void) { return got3; }
`);
const r: any = (cc as any)({
  source: f,
  symbols: {
    make_class: { args: [], returns: FFIType.ptr },
    new_instance: { args: [FFIType.ptr], returns: FFIType.ptr },
    send1: { args: [FFIType.ptr, FFIType.i64], returns: FFIType.i64 },
    send2: { args: [FFIType.ptr, FFIType.i64, FFIType.i64], returns: FFIType.i64 },
    send3: { args: [FFIType.ptr, FFIType.i64, FFIType.i64, FFIType.i64], returns: FFIType.i64 },
    seen1: { args: [], returns: FFIType.i64 },
    seen2: { args: [], returns: FFIType.i64 },
    seen3: { args: [], returns: FFIType.i64 },
  },
});
const cls = r.symbols.make_class();
const inst = r.symbols.new_instance(cls);
console.log("class:", cls, "inst:", inst);
console.log("send1(inst, 7) =", r.symbols.send1(inst, 7), " callee saw:", r.symbols.seen1(), "(expect 7)");
console.log("send2(inst, 7, 8) =", r.symbols.send2(inst, 7, 8), " callee saw:", r.symbols.seen2(), "(expect 7008)");
console.log("send3(inst, 7, 8, 9) =", r.symbols.send3(inst, 7, 8, 9), " callee saw:", r.symbols.seen3(), "(expect 7008009)");
process.exit(0);