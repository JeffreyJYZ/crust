// probe24: JSCallback into cc()-compiled C, and delegate-style class creation
import { cc, FFIType, JSCallback, dlopen } from "bun:ffi";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
const d = mkdtempSync(join(tmpdir(), "crust-p24-"));
function w(n: string, code: string) { const f = join(d, n + ".c"); writeFileSync(f, code); return f; }

// 1. C calls back into JS through a function pointer argument
const cb = w("cb", `
typedef int (*visit_fn)(int value, void *user);
int total(int n, visit_fn fn, void *user) {
  int acc = 0;
  for (int i = 0; i < n; i++) acc += fn(i, user);
  return acc;
}
`);
try {
  const r: any = (cc as any)({ source: cb, symbols: { total: { args: [FFIType.int, FFIType.function, FFIType.ptr], returns: FFIType.int } } });
  const seen: number[] = [];
  const jscb = new JSCallback((v: number) => { seen.push(v); return v * 10; }, { args: [FFIType.int, FFIType.ptr], returns: FFIType.int });
  console.log("PASS JSCallback compile; total(5) =", r.symbols.total(5, jscb, ptr0()), "seen =", seen.join(","));
} catch (e: any) {
  console.log("FAIL JSCallback:", e.message);
}
function ptr0() { return 0; }

// 2. runtime class creation + class_addMethod with an IMP from C
const cls = w("cls", `
#include <stdlib.h>
extern void *objc_getClass(const char *);
extern void *sel_registerName(const char *);
extern void *objc_allocateClassPair(void *, const char *, size_t);
int objc_addMethod(void *, void *, void *, const char *);
extern void *objc_msgSend(void *, void *, ...);

static int crust_incr(void *self, void *sel, int n) { return n + 1; }

void *make_delegate_class(void) {
  void *base = (void *)objc_getClass("NSObject");
  void *cls = objc_allocateClassPair(base, "CrustProbeDelegate", 0);
  if (!cls) return 0;
  int ok = objc_addMethod(cls, sel_registerName("incr:"), (void *)crust_incr, "i@:i");
  return ok ? cls : 0;
}

int call_incr_on_class(void *cls) {
  void *sel = (void *)sel_registerName("incr:");
  void *inst = objc_msgSend(cls, sel_registerName("alloc"));
  inst = objc_msgSend(inst, sel_registerName("init"));
  return (int)(long)objc_msgSend(inst, sel, 41);
}
`);
try {
  const r: any = (cc as any)({ source: cls, symbols: { make_delegate_class: { args: [], returns: FFIType.ptr }, call_incr_on_class: { args: [FFIType.ptr], returns: FFIType.int } } });
  const c = r.symbols.make_delegate_class();
  console.log("PASS delegate class compile; make_delegate_class ->", c);
  if (c) console.log("  call_incr_on_class ->", r.symbols.call_incr_on_class(c));
} catch (e: any) {
  console.log("FAIL delegate class:", String(e.message).split("\n").filter(Boolean).slice(-1)[0]);
}
process.exit(0);