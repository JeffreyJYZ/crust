// probe31: temp dylib lifecycle — does close() unlink it, and is a path reused?
import { cc, FFIType } from "bun:ffi";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
const d = mkdtempSync(join(tmpdir(), "crust-p31-"));
const f = join(d, "a.c");
writeFileSync(f, "int a(void) { return 1; }\n");

const count = () => readdirSync(tmpdir()).filter((n) => n.startsWith(".bun-")).length;
const before = count();
const r1: any = (cc as any)({ source: f, symbols: { a: { args: [], returns: FFIType.int } } });
const afterCompile = count();
console.log("tmp dylibs before/after compile:", before, afterCompile);
const r2: any = (cc as any)({ source: f, symbols: { a: { args: [], returns: FFIType.int } } });
console.log("after 2nd compile of same path:", count());
r1.close?.();
console.log("after close() #1:", count());
r2.close?.();
console.log("after close() #2:", count());
try { console.log("use after close: a() =", r2.symbols.a()); } catch (e: any) { console.log("use after close FAILED:", e.message); }
// does a source array work?
try {
  const g = join(d, "b.c"); writeFileSync(g, "int b(void) { return 2; }\n");
  const r3: any = (cc as any)({ source: [f, g], symbols: { a: { args: [], returns: FFIType.int }, b: { args: [], returns: FFIType.int } } });
  console.log("PASS source array:", r3.symbols.a(), r3.symbols.b());
} catch (e: any) { console.log("FAIL source array:", e.message); }
process.exit(0);