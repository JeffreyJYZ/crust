// probe11: granular e2e, header matrix, framework include paths
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
  nsapp_is_nonnull: { args: [], returns: FFIType.int },
  get_nsapp: { args: [], returns: FFIType.ptr },
});
if (steps) {
  for (const k of ["step_class", "step_sel", "step_alloc", "step_init", "step_description_returns_ptr", "step_utf8_nonnull", "step_utf8_first_byte", "step_utf8_strlen_via_c"]) {
    call(k, () => steps.symbols[k]());
  }
  // NSString round trip with a real pointer
  const buf = new TextEncoder().encode("hello");
  const p = ptr(buf);
  call(`string_roundtrip_length(ptr 'hello') [ptr=${p}]`, () => steps.symbols.string_roundtrip_length(p));
  call("nsapp_is_nonnull", () => steps.symbols.nsapp_is_nonnull());
  call("get_nsapp", () => steps.symbols.get_nsapp());
}

console.log("--- headers ---");
const sdk = "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk";
const hdrs = tryCC("stdio+string+stdlib", join(dir, "hdr_all.c"), { hdr_all: { args: [], returns: FFIType.int } });
if (hdrs) call("hdr_all()", () => hdrs.symbols.hdr_all());

console.log("--- foundation/appkit includes, with -I sdk usr/include ---");
for (const [label, src, extra] of [
  ["foundation -I sdk", join(dir, "foundation_include.c"), { flags: [`-I${sdk}/usr/include`, "-framework", "Foundation"] }],
  ["foundation -isystem sdk", join(dir, "foundation_include.c"), { flags: [`-isystem${sdk}/usr/include`] }],
  ["foundation -F sdk frameworks", join(dir, "foundation_include.c"), { flags: [`-F${sdk}/System/Library/Frameworks`] }],
] as [string, string, any][]) {
  const r = tryCC(label, src, { foundation_string_class: { args: [], returns: FFIType.ptr }, foundation_roundtrip: { args: [FFIType.cstring], returns: FFIType.int } }, extra);
  if (r) call("  foundation_string_class", () => r.symbols.foundation_string_class());
}
process.exit(0);