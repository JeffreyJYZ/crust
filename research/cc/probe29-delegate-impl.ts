// probe29: does the runtime-created class's IMP actually run when called correctly?
import { cc, FFIType } from "bun:ffi";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
const d = mkdtempSync(join(tmpdir(), "crust-p29-"));
const f = join(d, "del.c");
writeFileSync(f, `#include <stdlib.h>
extern void *objc_getClass(const char *);
extern void *sel_registerName(const char *);
extern void *objc_allocateClassPair(void *, const char *, size_t);
int class_addMethod(void *, void *, void *, const char *);
extern void *objc_msgSend(void *, void *, ...);

static long hit = -1;
static long imp(void *s, void *sel, long a) { hit = a; return a + 1; }

void *mk(void) {
  void *cls = objc_allocateClassPair((void *)objc_getClass("NSObject"), "P29", 0);
  if (!cls) return 0;
  return class_addMethod(cls, sel_registerName("bump:"), (void *)imp, "q@:q") ? cls : 0;
}

void *mk_inst(void *cls) {
  void *i = objc_msgSend(cls, sel_registerName("alloc"));
  return i ? objc_msgSend(i, sel_registerName("init")) : 0;
}

long call_fixed(void *inst, long a) { return ((long (*)(void *, void *, long))objc_msgSend)(inst, sel_registerName("bump:"), a); }
long call_variadic(void *inst, long a) { return (long)objc_msgSend(inst, sel_registerName("bump:"), a); }
long hit_val(void) { return hit; }
`);
const r: any = (cc as any)({ source: f, symbols: {
  mk: { args: [], returns: FFIType.ptr },
  mk_inst: { args: [FFIType.ptr], returns: FFIType.ptr },
  call_fixed: { args: [FFIType.ptr, FFIType.i64], returns: FFIType.i64 },
  call_variadic: { args: [FFIType.ptr, FFIType.i64], returns: FFIType.i64 },
  hit_val: { args: [], returns: FFIType.i64 },
} });
const cls = r.symbols.mk();
console.log("class:", cls);
const inst = r.symbols.mk_inst(cls);
console.log("inst:", inst);
console.log("call_fixed(inst, 41) =", Number(r.symbols.call_fixed(inst, 41)), " hit =", Number(r.symbols.hit_val()), "(expect 42 / 41)");
console.log("call_variadic(inst, 7) =", Number(r.symbols.call_variadic(inst, 7)), " hit =", Number(r.symbols.hit_val()), "(expect 8 / 7)");
process.exit(0);