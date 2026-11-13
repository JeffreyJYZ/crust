// probe21: why doesn't -I on Framework Headers work? test a plain dir with the same file.
import { cc, FFIType } from "bun:ffi";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
const d = mkdtempSync(join(tmpdir(), "crust-inc-"));
const sdk = "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk";
const fwHeaders = `${sdk}/System/Library/Frameworks/Foundation.framework/Headers`;
const cfHeaders = `${sdk}/System/Library/Frameworks/CoreFoundation.framework/Headers`;

function probe(label: string, code: string, flags?: string[]) {
  const f = join(d, label.replaceAll(/[^a-z0-9]/gi, "_") + ".c");
  writeFileSync(f, code);
  try {
    const r: any = (cc as any)({ source: f, symbols: { probe: { args: [], returns: FFIType.int } }, flags });
    console.log(`PASS ${label}`);
    try { r.close?.(); } catch {}
  } catch (e: any) {
    const lines = String(e?.message ?? e).split("\n").filter(Boolean);
    console.log(`FAIL ${label} :: ${lines.slice(-1)[0]}`);
  }
}

// 1. copy Foundation.h into a flat dir and include it there
mkdirSync(join(d, "fakeinc"), { recursive: true });
copyFileSync(`${fwHeaders}/Foundation.h`, join(d, "fakeinc", "Foundation.h"));
probe("plain dir with Foundation.h copied in", `#include <Foundation.h>\nint probe(void){return 0;}\n`,
  [`-I${d}/fakeinc`]);

// 2. absolute path include
probe("absolute path include", `#include "${fwHeaders}/Foundation.h"\nint probe(void){return 0;}\n`);

// 3. -I with trailing slash / relative
probe("-I with trailing slash", `#include <Foundation/Foundation.h>\nint probe(void){return 0;}\n`,
  [`-I${sdk}/System/Library/Frameworks/`]);

// 4. is the option string parsed at all? try -include
probe("-include stdlib", `int probe(void){return 0;}\n`, ["-include", "stdlib.h"]);

// 5. does a bogus -I error?
probe("bogus -I", `#include <stdlib.h>\nint probe(void){return 0;}\n`, ["-I/nonexistent/path/xyz"]);

// 6. verbose to see tcc's actual search dirs
try {
  (cc as any)({ source: join(d, "x.c"), symbols: { probe: { args: [], returns: FFIType.int } }, flags: ["-v"] });
} catch (e: any) {
  console.log("--- verbose output ---");
  console.log(String(e.message).slice(0, 3000));
}
process.exit(0);