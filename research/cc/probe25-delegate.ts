// probe25: delegate class with class_addMethod (the real symbol name)
import { cc, FFIType } from "bun:ffi";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
const d = mkdtempSync(join(tmpdir(), "crust-p25-"));
const f = join(d, "delegate.c");
writeFileSync(f, `
#include <stdlib.h>
extern void *objc_getClass(const char *);
extern void *sel_registerName(const char *);
extern void *objc_allocateClassPair(void *, const char *, size_t);
int class_addMethod(void *, void *, void *, const char *);
extern void *objc_msgSend(void *, void *, ...);

static int crust_incr(void *self, void *sel, int n) { return n + 1; }

void *make_delegate_class(void) {
  void *base = (void *)objc_getClass("NSObject");
  void *cls = objc_allocateClassPair(base, "CrustProbeDelegate", 0);
  if (!cls) return 0;
  void *sel = sel_registerName("incr:");
  int ok = class_addMethod(cls, sel, (void *)crust_incr, "i@:i");
  return ok ? cls : 0;
}

int call_incr_on_class(void *cls) {
  void *alloc = (void *)sel_registerName("alloc");
  void *init = (void *)sel_registerName("init");
  void *sel = (void *)sel_registerName("incr:");
  void *inst = objc_msgSend(cls, alloc);
  if (!inst) return -1;
  inst = objc_msgSend(inst, init);
  if (!inst) return -2;
  long r = (long)objc_msgSend(inst, sel, 41);
  return (int)r;
}
`);
try {
  const r: any = (cc as any)({
    source: f,
    symbols: {
      make_delegate_class: { args: [], returns: FFIType.ptr },
      call_incr_on_class: { args: [FFIType.ptr], returns: FFIType.int },
    },
  });
  const c = r.symbols.make_delegate_class();
  console.log("PASS delegate compile; make_delegate_class ->", c);
  if (c) console.log("  call_incr_on_class ->", r.symbols.call_incr_on_class(c));
} catch (e: any) {
  console.log("FAIL delegate:", String(e.message).split("\n").filter(Boolean).slice(-1)[0]);
}
process.exit(0);