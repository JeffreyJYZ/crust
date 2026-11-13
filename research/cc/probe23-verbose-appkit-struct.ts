// probe23: include search dirs (-v), AppKit-only symbol link, struct returns
import { cc, FFIType } from "bun:ffi";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
const d = mkdtempSync(join(tmpdir(), "crust-p23-"));
function w(name: string, code: string) { const f = join(d, name + ".c"); writeFileSync(f, code); return f; }
function probe(label: string, code: string, flags?: string[], symbols?: any) {
  try {
    const r: any = (cc as any)({ source: typeof code === "string" && code.endsWith(".c") && !code.includes("\n") ? code : w(label, code), symbols: symbols ?? { probe: { args: [], returns: FFIType.int } }, flags });
    console.log(`PASS ${label}`);
    return r;
  } catch (e: any) {
    const lines = String(e?.message ?? e).split("\n").filter(Boolean);
    console.log(`FAIL ${label} :: ${lines.slice(-1)[0]}`);
    return null;
  }
}

// 1. verbose: tcc's own search dirs
try {
  const f = w("vprobe", "int probe(void){return 0;}\n");
  (cc as any)({ source: f, symbols: { probe: { args: [], returns: FFIType.int } }, flags: ["-v"] });
  console.log("PASS -v (no error)");
} catch (e: any) {
  console.log("--- verbose stderr ---");
  console.log(String(e.message));
}

// 2. AppKit-only symbol: must fail without -framework AppKit
const appkitOnly = `
extern void *objc_getClass(const char *);
extern void *NSApp;
int probe(void) { return NSApp != 0; }
`;
const a1 = probe("appkit symbol, no flags", appkitOnly);
const a2 = probe("appkit symbol, -framework AppKit", appkitOnly, ["-framework", "AppKit"]);
if (a2) { try { console.log("  NSApp nonnull =", a2.symbols.probe()); } catch (e: any) { console.log("  call fail:", e.message); } }

// 3. struct return: does a cc()-compiled function return CGRect correctly through bun:ffi?
const structRet = `
typedef struct { double x, y, w, h; } CGRect;
typedef struct { double w, h; } CGSize;
CGRect make_rect(double x, double y, double w, double h) {
  CGRect r; r.x = x; r.y = y; r.w = w; r.h = h; return r;
}
double rect_width(CGRect r) { return r.w; }
CGSize make_size(double w, double h) { CGSize s; s.w = w; s.h = h; return s; }
double sum_squares(double a, double b) { return a*a + b*b; }
`;
const s1 = probe("struct return (no ffi struct decl)", structRet, [], {
  make_rect: { args: [FFIType.double, FFIType.double, FFIType.double, FFIType.double], returns: FFIType.ptr },
  rect_width: { args: [FFIType.ptr], returns: FFIType.double },
  make_size: { args: [FFIType.double, FFIType.double], returns: FFIType.ptr },
  sum_squares: { args: [FFIType.double, FFIType.double], returns: FFIType.double },
});
if (s1) {
  try {
    const r = s1.symbols.make_rect(1, 2, 3, 4);
    console.log("  make_rect ->", r);
    console.log("  rect_width ->", s1.symbols.rect_width(r));
    console.log("  make_size ->", s1.symbols.make_size(5, 6));
    console.log("  sum_squares(3,4) ->", s1.symbols.sum_squares(3, 4));
  } catch (e: any) { console.log("  call fail:", e.message); }
}
process.exit(0);