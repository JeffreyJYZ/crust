// probe19b: header resolution matrix, with symbols supplied
import { cc, FFIType } from "bun:ffi";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const d = mkdtempSync(join(tmpdir(), "crust-hdr-"));
const cases = [
  "stdlib.h", "string.h", "stdio.h", "stdint.h", "math.h",
  "objc/message.h", "objc/runtime.h", "objc/objc.h",
  "pthread.h", "sys/stat.h", "dirent.h",
  "Foundation/Foundation.h", "AppKit/AppKit.h",
  "CoreFoundation/CoreFoundation.h", "CoreGraphics/CoreGraphics.h",
];
const syms = { main: { args: [], returns: FFIType.int } };
const ok: string[] = [], bad: string[] = [];
for (const h of cases) {
  const f = join(d, h.replaceAll("/", "_") + ".c");
  writeFileSync(f, `#include <${h}>\nint main(void){return 0;}\n`);
  try {
    const r: any = (cc as any)({ source: f, symbols: syms });
    ok.push(h);
    try { r.close?.(); } catch {}
  } catch (e: any) {
    const msg = String(e?.message ?? e).split("\n").filter(Boolean).slice(-1)[0] ?? String(e.message);
    bad.push(`${h} :: ${msg}`);
  }
}
console.log("RESOLVED:", ok.join(", "));
console.log("NOT RESOLVED:");
for (const b of bad) console.log("  " + b);
process.exit(0);