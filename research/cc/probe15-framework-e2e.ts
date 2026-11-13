// probe15: e2e with framework link, and a description-length proof that needs no strings
import { cc, FFIType, ptr } from "bun:ffi";
import { join } from "node:path";
const dir = new URL("./c/", import.meta.url).pathname;

function tryCC(label: string, source: string, symbols?: any, extra?: any) {
  const s = performance.now();
  try {
    const res: any = (cc as any)({ source, symbols, ...extra });
    console.log(`PASS ${label} [${(performance.now() - s).toFixed(2)}ms]`);
    return res;
  } catch (e: any) {
    console.log(`FAIL ${label} ${String(e?.message ?? e).replace(/\n/g, " | ")}`);
    return null;
  }
}
function call(label: string, fn: any) {
  try { console.log(`  ${label} ->`, fn()); }
  catch (e: any) { console.log(`  ${label} FAILED: ${e?.message ?? e}`); }
}

const syms = {
  description_len: { args: [], returns: FFIType.int },
  homedir_first_byte: { args: [], returns: FFIType.int },
  homedir_len: { args: [], returns: FFIType.int },
};

for (const [label, extra] of [
  ["no flags", {}],
  ["-framework Foundation", { flags: ["-framework", "Foundation"] }],
  ["-framework AppKit", { flags: ["-framework", "AppKit"] }],
  ["both frameworks", { flags: ["-framework", "Foundation", "-framework", "AppKit"] }],
] as [string, any][]) {
  const r = tryCC(`e2e ${label}`, join(dir, "framework_e2e.c"), syms, extra);
  if (r) {
    call("  description_len()", () => r.symbols.description_len());
    call("  homedir_first_byte() [47='/']", () => r.symbols.homedir_first_byte());
    call("  homedir_len()", () => r.symbols.homedir_len());
    try { r.close?.(); } catch {}
  }
}
process.exit(0);