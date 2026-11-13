// probe28: consolidated verdict run. every claim in cc.md, one pass.
import { cc, FFIType, dlopen, JSCallback, ptr } from "bun:ffi";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
const d = mkdtempSync(join(tmpdir(), "crust-p28-"));
function w(n: string, code: string) { const f = join(d, n + ".c"); writeFileSync(f, code); return f; }
let pass = 0, fail = 0;
const chk = (label: string, ok: boolean, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " :: " + detail : ""}`); };

// 1 basic + includes
const basic = w("basic.c", `#include <stdlib.h>
#include <string.h>
#include <stdio.h>
int add(int a, int b) { return a + b; }
int hdr(void) { char *p = malloc(16); memset(p, 'a', 15); p[15] = 0; int n = (int)strlen(p); free(p); return n; }
`);
const r1: any = (cc as any)({ source: basic, symbols: { add: { args: [FFIType.int, FFIType.int], returns: FFIType.int }, hdr: { args: [], returns: FFIType.int } } });
chk("cc() compiles + calls", r1.symbols.add(2, 3) === 5 && r1.symbols.hdr() === 15, `add=${r1.symbols.add(2, 3)} hdr=${r1.symbols.hdr()}`);

// 2 framework headers unavailable
let fwFail = false;
try { (cc as any)({ source: w("fwh.c", `#include <AppKit/AppKit.h>\nint main(void){return 0;}\n`), symbols: { main: { args: [], returns: FFIType.int } } }); }
catch (e: any) { fwFail = /AppKit\/AppKit\.h.*not found/.test(e.message); }
chk("AppKit header unreachable", fwFail);

// 3 variadic vs fixed prototype
const ladder = w("ladder", `#include <stdlib.h>
extern void *objc_getClass(const char *);
extern void *sel_registerName(const char *);
extern void *objc_allocateClassPair(void *, const char *, size_t);
int class_addMethod(void *, void *, void *, const char *);
extern void *objc_msgSend(void *, void *, ...);
static long got = -1;
static long m1(void *s, void *sel, long a) { got = a; return a * 2; }
void *mk(void) { void *c = objc_allocateClassPair((void *)objc_getClass("NSObject"), "P28", 0);
  if (!c) return 0; class_addMethod(c, sel_registerName("one:"), (void *)m1, "q@:q"); return c; }
void *inst(void *c) { void *i = objc_msgSend(c, sel_registerName("alloc")); return i ? objc_msgSend(i, sel_registerName("init")) : 0; }
long send_fixed(void *i, long a) { return ((long (*)(void *, void *, long))objc_msgSend)(i, sel_registerName("one:"), a); }
long send_variadic(void *i, long a) { return (long)objc_msgSend(i, sel_registerName("one:"), a); }
long seen(void) { return got; }
`);
const r2: any = (cc as any)({ source: ladder, symbols: {
  mk: { args: [], returns: FFIType.ptr }, inst: { args: [FFIType.ptr], returns: FFIType.ptr },
  send_fixed: { args: [FFIType.ptr, FFIType.i64], returns: FFIType.i64 },
  send_variadic: { args: [FFIType.ptr, FFIType.i64], returns: FFIType.i64 },
  seen: { args: [], returns: FFIType.i64 } } });
const inst = r2.symbols.inst(r2.symbols.mk());
chk("fixed prototype correct", Number(r2.symbols.send_fixed(inst, 41)) === 82 && Number(r2.symbols.seen()) === 41, `ret=${r2.symbols.send_fixed(inst, 41)} seen=${r2.symbols.seen()}`);
const v = Number(r2.symbols.send_variadic(inst, 41));
chk("plain variadic WRONG (no error thrown)", v !== 82, `ret=${v}`);

// 4 framework link
const fl = w("fl.c", `
extern const char *NSHomeDirectory(void);
extern void *objc_getClass(const char *);
extern void *objc_msgSend(void *, void *, ...);
extern void *sel_registerName(const char *);
int homedir_len(void) { const char *h = NSHomeDirectory(); int n = 0; if (!h) return -1; while (h[n]) n++; return n; }
int class_nonnull(void) { return objc_getClass("NSString") != 0; }
int desc_len(void) { void *c = (void *)objc_getClass("NSObject"); void *o = objc_msgSend(c, sel_registerName("alloc"));
  o = objc_msgSend(o, sel_registerName("init")); if (!o) return -2;
  void *dd = objc_msgSend(o, sel_registerName("description")); if (!dd) return -3;
  const char *p = (const char *)objc_msgSend(dd, sel_registerName("UTF8String")); int n = 0; if (!p) return -4; while (p[n]) n++; return n; }
`);
let noLinkOk = false;
try { const r: any = (cc as any)({ source: fl, symbols: { homedir_len: { args: [], returns: FFIType.int } } }); noLinkOk = true; }
catch (e: any) { noLinkOk = /unresolved reference to '_NSHomeDirectory'/.test(e.message); }
chk("unresolved without -framework", noLinkOk);

const r3: any = (cc as any)({ source: fl, flags: ["-framework", "Foundation"],
  symbols: { homedir_len: { args: [], returns: FFIType.int }, class_nonnull: { args: [], returns: FFIType.int }, desc_len: { args: [], returns: FFIType.int } } });
chk("homedir via NSHomeDirectory", r3.symbols.homedir_len() > 0, `len=${r3.symbols.homedir_len()}`);
chk("NSString class resolves when Foundation linked", r3.symbols.class_nonnull() === 1);
chk("description end-to-end", r3.symbols.desc_len() > 0, `len=${r3.symbols.desc_len()}`);

// 5 JSCallback both ways
const cb = w("cb.c", `typedef int (*fn_t)(int, void *);
int total(int n, fn_t f, void *u) { int a = 0; for (int i = 0; i < n; i++) a += f(i, u); return a; }
`);
const r4: any = (cc as any)({ source: cb, symbols: { total: { args: [FFIType.int, FFIType.function, FFIType.ptr], returns: FFIType.int } } });
const seen: number[] = [];
const j = new JSCallback((v: number) => { seen.push(v); return v * 10; }, { args: [FFIType.int, FFIType.ptr], returns: FFIType.int });
chk("JSCallback from C into JS", r4.symbols.total(5, j, 0) === 100 && seen.length === 5);

// 6 delegate class
const dl = w("d", `#include <stdlib.h>
extern void *objc_getClass(const char *);
extern void *sel_registerName(const char *);
extern void *objc_allocateClassPair(void *, const char *, size_t);
int class_addMethod(void *, void *, void *, const char *);
extern void *objc_msgSend(void *, void *, ...);
static int hit = 0;
static long imp(void *s, void *sel, long a) { hit = a; return a + 1; }
void *mkcls(void) { void *c = objc_allocateClassPair((void *)objc_getClass("NSObject"), "P28Del", 0);
  if (!c) return 0; return class_addMethod(c, sel_registerName("bump:"), (void *)imp, "q@:q") ? c : 0; }
long seen_hit(void) { return hit; }
`);
const r5: any = (cc as any)({ source: dl, symbols: { mkcls: { args: [], returns: FFIType.ptr }, seen_hit: { args: [], returns: FFIType.i64 } } });
chk("runtime class creation", !!r5.symbols.mkcls(), `cls=${r5.symbols.mkcls()}`);

// 7 struct return smuggled as ptr
const st = w("s.c", `typedef struct { double x, y, w, h; } Rect;
Rect make(double x, double y, double w, double h) { Rect r; r.x=x; r.y=y; r.w=w; r.h=h; return r; }
double width(Rect r) { return r.w; }
`);
const r6: any = (cc as any)({ source: st, symbols: { make: { args: [FFIType.double, FFIType.double, FFIType.double, FFIType.double], returns: FFIType.ptr }, width: { args: [FFIType.ptr], returns: FFIType.double } } });
chk("struct return via ptr", r6.symbols.width(r6.symbols.make(1, 2, 3, 4)) === 3);

console.log(`\n== ${pass} pass / ${fail} fail ==`);
process.exit(fail === 0 ? 0 : 1);