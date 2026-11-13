// probe10: e2e with correct FFIType names
import { cc, FFIType, CString } from "bun:ffi";
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

const e2e = tryCC("A: e2e no objc headers", join(dir, "e2e_no_message_h.c"), {
  describe_new_object: { args: [], returns: FFIType.cstring },
  class_returns_self: { args: [], returns: FFIType.int },
  string_roundtrip_length: { args: [FFIType.cstring], returns: FFIType.int },
  roundtrip_pointer: { args: [], returns: FFIType.ptr },
});
if (e2e) {
  const d = call("describe_new_object()", () => e2e.symbols.describe_new_object());
  if (typeof d === "string") console.log("    description:", JSON.stringify(d));
  call("class_returns_self()", () => e2e.symbols.class_returns_self());
  call("string_roundtrip_length('hello')", () => e2e.symbols.string_roundtrip_length("hello"));
  const p = call("roundtrip_pointer()", () => e2e.symbols.roundtrip_pointer());
  console.log("    pointer non-null:", p !== null && p !== 0);
}

// framework link attempts, calling the symbol to prove it linked
const linkShapes: [string, any][] = [
  ["flags -framework AppKit", { flags: ["-framework", "AppKit"] }],
  ["flags -l AppKit", { flags: ["-framework", "AppKit", "-lobjc", "-Wl,-rpath,/usr/lib"] }],
  ["libraries -framework AppKit", { libraries: ["-framework", "AppKit"] }],
  ["link -framework AppKit", { link: ["-framework", "AppKit"] }],
];
for (const [label, extra] of linkShapes) {
  const r = tryCC(`C: ${label}`, join(dir, "appkit_symbol_ref.c"),
    { get_nsapp: { args: [], returns: FFIType.ptr }, nsapp_is_nonnull: { args: [], returns: FFIType.int }, foundation_string_class: { args: [], returns: FFIType.ptr } },
    extra);
  if (r) {
    call("  nsapp_is_nonnull()", () => r.symbols.nsapp_is_nonnull());
    call("  get_nsapp()", () => r.symbols.get_nsapp());
    call("  foundation_string_class()", () => r.symbols.foundation_string_class());
  }
}
process.exit(0);