// probe26: does a *variadic* objc_msgSend call pass extra args correctly on arm64?
import { cc, FFIType, ptr } from "bun:ffi";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
const d = mkdtempSync(join(tmpdir(), "crust-p26-"));
const f = join(d, "variadic.c");
writeFileSync(f, `
#include <stdlib.h>
extern void *objc_getClass(const char *);
extern void *sel_registerName(const char *);
extern void *objc_allocateClassPair(void *, const char *, size_t);
int class_addMethod(void *, void *, void *, const char *);
extern void *objc_msgSend(void *, void *, ...);

static int seen_int = -999;
static long seen_ptr = -999;

static int take_int(void *self, void *sel, int n) { seen_int = n; return n + 1; }
static int take_ptr(void *self, void *sel, long n) { seen_ptr = n; return n + 1; }

void *make_class(void) {
  void *base = (void *)objc_getClass("NSObject");
  void *cls = objc_allocateClassPair(base, "CrustProbeVariadic", 0);
  if (!cls) return 0;
  class_addMethod(cls, sel_registerName("takeInt:"), (void *)take_int, "i@:i");
  class_addMethod(cls, sel_registerName("takePtr:"), (void *)take_int, "i@:i");
  return cls;
}

void *new_instance(void *cls) {
  void *inst = objc_msgSend(cls, sel_registerName("alloc"));
  return inst ? objc_msgSend(inst, sel_registerName("init")) : 0;
}

// variadic call: int arg
int send_int(void *inst, int n) {
  return (int)(long)objc_msgSend(inst, sel_registerName("takeInt:"), n);
}
int last_seen_int(void) { return seen_int; }

// variadic call: pointer arg
long send_ptr(void *inst, long p) {
  return (long)objc_msgSend(inst, sel_registerName("takePtr:"), p);
}
long last_seen_ptr(void) { return seen_ptr; }

// zero-arg variadic
int send_noarg(void *inst) {
  return (int)(long)objc_msgSend(inst, sel_registerName("description") != 0 ? sel_registerName("self") : 0);
}

// non-variadic fixed prototype (2 args) for comparison
typedef long (*send2_fn)(void *, void *, long);
int send_int_fixed(void *inst, int n) {
  send2_fn f = (send2_fn)&objc_msgSend;
  return (int)f(inst, sel_registerName("takeInt:"), n);
}
`);
try {
  const r: any = (cc as any)({
    source: f,
    symbols: {
      make_class: { args: [], returns: FFIType.ptr },
      new_instance: { args: [FFIType.ptr], returns: FFIType.ptr },
      send_int: { args: [FFIType.ptr, FFIType.int], returns: FFIType.int },
      last_seen_int: { args: [], returns: FFIType.int },
      send_ptr: { args: [FFIType.ptr, FFIType.i64], returns: FFIType.i64 },
      last_seen_ptr: { args: [], returns: FFIType.i64 },
      send_int_fixed: { args: [FFIType.ptr, FFIType.int], returns: FFIType.int },
      send_noarg: { args: [FFIType.ptr], returns: FFIType.int },
    },
  });
  const c = r.symbols.make_class();
  console.log("make_class ->", c);
  const inst = r.symbols.new_instance(c);
  console.log("new_instance ->", inst);
  console.log("send_int(inst, 41) ->", r.symbols.send_int(inst, 41), " seen_int =", r.symbols.last_seen_int());
  console.log("send_int_fixed(inst, 42) ->", r.symbols.send_int_fixed(inst, 42), " seen_int =", r.symbols.last_seen_int());
  console.log("send_ptr(inst, 123456) ->", r.symbols.send_ptr(inst, 123456), " seen_ptr =", r.symbols.last_seen_ptr());
  console.log("send_noarg(inst) ->", r.symbols.send_noarg(inst));
} catch (e: any) {
  console.log("FAIL:", String(e.message).split("\n").filter(Boolean).slice(-1)[0]);
}
process.exit(0);