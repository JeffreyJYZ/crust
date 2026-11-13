// probe13: e2e steps + real framework link proof
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

const steps = tryCC("e2e steps", join(dir, "e2e_steps.c"), {
  step_class: { args: [], returns: FFIType.int },
  step_sel: { args: [], returns: FFIType.int },
  step_alloc: { args: [], returns: FFIType.int },
  step_init: { args: [], returns: FFIType.int },
  step_description_returns_ptr: { args: [], returns: FFIType.int },
  step_utf8_nonnull: { args: [], returns: FFIType.int },
  step_utf8_first_byte: { args: [], returns: FFIType.int },
  step_utf8_strlen_via_c: { args: [], returns: FFIType.int },
  string_roundtrip_length: { args: [FFIType.ptr], returns: FFIType.int },
  string_class_nonnull: { args: [], returns: FFIType.int },
});
if (steps) {
  for (const k of ["step_class", "step_sel", "step_alloc", "step_init", "step_description_returns_ptr", "step_utf8_nonnull", "step_utf8_first_byte", "step_utf8_strlen_via_c", "string_class_nonnull"]) {
    call(k, () => steps.symbols[k]());
  }
  const buf = new TextEncoder().encode("hello");
  const p = ptr(buf);
  call(`string_roundtrip_length(ptr 'hello')`, () => steps.symbols.string_roundtrip_length(p));
}

console.log("--- framework link: NSHomeDirectory is a Foundation *function* ---");
for (const [label, extra] of [
  ["no link flags", {}],
  ["flags -framework Foundation", { flags: ["-framework", "Foundation"] }],
  ["flags -lFoundation", { flags: ["-lFoundation"] }],
  ["flags -framework Foundation -F sdk", { flags: ["-framework", "Foundation", "-F/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/System/Library/Frameworks"] }],
] as [string, any][]) {
  const r = tryCC(`link: ${label}`, join(dir, "framework_link.c"),
    { foundation_class: { args: [], returns: FFIType.ptr }, use_nshomedir: { args: [], returns: FFIType.cstring } },
    extra);
  if (r) {
    call("  foundation_class()", () => r.symbols.foundation_class());
    call("  use_nshomedir()", () => r.symbols.use_nshomedir());
  }
}

console.log("--- header search for framework headers ---");
const sdk = "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk";
const fwInc = [
  `-I${sdk}/usr/include`,
  `-I${sdk}/System/Library/Frameworks/Foundation.framework/Headers`,
  `-I${sdk}/System/Library/Frameworks/CoreFoundation.framework/Headers`,
];
tryCC("foundation include w/ 3 -I", join(dir, "foundation_include.c"),
  { foundation_string_class: { args: [], returns: FFIType.ptr }, foundation_roundtrip: { args: [FFIType.cstring], returns: FFIType.int } },
  { flags: fwInc });
process.exit(0);