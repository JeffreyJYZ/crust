// probe07: e2e, defines, framework link attempts
import { cc, FFIType, CString, ptr } from "bun:ffi";
import { join } from "node:path";
const dir = new URL("./c/", import.meta.url).pathname;

function tryCC(label: string, source: string, symbols?: any, extra?: any) {
  const s = performance.now();
  try {
    const res: any = (cc as any)({ source, symbols, ...extra });
    console.log(`PASS ${label} [${(performance.now() - s).toFixed(2)}ms]`);
    return res;
  } catch (e: any) {
    console.log(`FAIL ${label} ${e?.message ?? e}`);
    return null;
  }
}
function call(label: string, fn: any) {
  try { const v = fn(); console.log(`  ${label} ->`, v); return v; }
  catch (e: any) { console.log(`  ${label} FAILED: ${e?.message ?? e}`); return null; }
}

// A. e2e with no objc headers at all
const e2e = tryCC("A: e2e no objc headers", join(dir, "e2e_no_message_h.c"), {
  describe_new_object: { args: [], returns: FFIType.cstring },
  class_returns_self: { args: [], returns: FFIType.int },
  string_roundtrip_length: { args: [FFIType.cstring], returns: FFIType.long },
  roundtrip_pointer: { args: [FFIType.ulong], returns: FFIType.ulong },
  objc_strlen: { args: [FFIType.cstring], returns: FFIType.long },
});
if (e2e) {
  const d = call("describe_new_object()", () => e2e.symbols.describe_new_object());
  if (d !== null && d !== 0) console.log("    description text:", JSON.stringify(d));
  call("class_returns_self()", () => e2e.symbols.class_returns_self());
  call("string_roundtrip_length('hello')", () => e2e.symbols.string_roundtrip_length("hello"));
  call("roundtrip_pointer(0)", () => e2e.symbols.roundtrip_pointer(0));
}

// B. defines option
for (const key of ["defines", "define", "D"]) {
  const extra: any = { symbols: { with_extra: { args: [], returns: FFIType.int }, always: { args: [FFIType.int], returns: FFIType.int } } };
  extra[key] = ["CRUST_EXTRA"];
  const r = tryCC(`B: ${key}=[CRUST_EXTRA]`, join(dir, "define_probe.c"), extra.symbols, { [key]: extra[key] });
  if (r) call(`with_extra via ${key}`, () => r.symbols.with_extra());
}
// control: no define
const noDef = tryCC("B: control (no define)", join(dir, "define_probe.c"), {
  with_extra: { args: [], returns: FFIType.int },
  always: { args: [FFIType.int], returns: FFIType.int },
});
if (noDef) call("with_extra (expect 0)", () => noDef.symbols.with_extra());

// C. framework link via extra flags
tryCC("C: -framework AppKit flags", join(dir, "appkit_symbol_ref.c"),
  { get_nsapp: { args: [], returns: FFIType.ptr } },
  { flags: ["-framework", "AppKit"] });

tryCC("C: libs=['AppKit']", join(dir, "appkit_symbol_ref.c"),
  { get_nsapp: { args: [], returns: FFIType.ptr } },
  { libraries: ["-framework", "AppKit"] });

tryCC("C: AppKit via linker", join(dir, "appkit_symbol_ref.c"),
  { get_nsapp: { args: [], returns: FFIType.ptr } },
  { link: ["-framework", "AppKit"] });

// D. plain include of AppKit header with an include dir
const sdk = "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk";
tryCC("D: appkit include", join(dir, "appkit_include.c"), {},
  { includes: [`${sdk}/usr/include`], include: [`${sdk}/usr/include`] });

process.exit(0);