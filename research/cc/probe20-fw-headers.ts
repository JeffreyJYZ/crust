// probe20: can tcc see framework headers via -I on each Framework's Headers dir?
import { cc, FFIType } from "bun:ffi";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
const d = mkdtempSync(join(tmpdir(), "crust-fwhdr-"));
const sdk = "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk";

function probe(label: string, code: string, flags?: string[]) {
  const f = join(d, label.replaceAll(/[^a-z0-9]/gi, "_") + ".c");
  writeFileSync(f, code);
  try {
    const r: any = (cc as any)({ source: f, symbols: { probe: { args: [], returns: FFIType.int } }, flags });
    console.log(`PASS ${label} flags=${JSON.stringify(flags ?? [])}`);
    try { r.close?.(); } catch {}
  } catch (e: any) {
    const lines = String(e?.message ?? e).split("\n").filter(Boolean);
    console.log(`FAIL ${label} flags=${JSON.stringify(flags ?? [])} :: ${lines.slice(-1)[0]}`);
  }
}

// minimal: does the header exist at all, and what does it need?
probe("foundation-min", `#include <Foundation/Foundation.h>\nint probe(void){return 0;}\n`);
probe("foundation-1I", `#include <Foundation/Foundation.h>\nint probe(void){return 0;}\n`,
  [`-I${sdk}/System/Library/Frameworks/Foundation.framework/Headers`]);
probe("foundation-1I-cf", `#include <Foundation/Foundation.h>\nint probe(void){return 0;}\n`,
  [`-I${sdk}/System/Library/Frameworks/Foundation.framework/Headers`,
   `-I${sdk}/System/Library/Frameworks/CoreFoundation.framework/Headers`]);
probe("cf-only", `#include <CoreFoundation/CoreFoundation.h>\nint probe(void){return 0;}\n`,
  [`-I${sdk}/System/Library/Frameworks/CoreFoundation.framework/Headers`]);
probe("appkit-1I", `#include <AppKit/AppKit.h>\nint probe(void){return 0;}\n`,
  [`-I${sdk}/System/Library/Frameworks/AppKit.framework/Headers`]);

// objc runtime header content: does it declare class_getName etc?
probe("objc-runtime-use", `#include <objc/runtime.h>\nint probe(void){ return class_getName(0) != 0; }\n`);
process.exit(0);