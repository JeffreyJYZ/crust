// probe06: objc deeper. typed msgSend, e2e, flags options discovery.
import { cc, FFIType, dlopen, ptr } from "bun:ffi";
import { join } from "node:path";
const dir = new URL("./c/", import.meta.url).pathname;

function tryCC(label: string, source: string, symbols?: any, extra?: any) {
  const s = performance.now();
  try {
    const res: any = (cc as any)({ source, symbols, ...extra });
    console.log(`PASS ${label} [${(performance.now() - s).toFixed(2)}ms]`);
    return res;
  } catch (e: any) {
    console.log(`FAIL ${label} [${(performance.now() - s).toFixed(2)}ms] ${e?.message ?? e}`);
    return null;
  }
}
function call(label: string, fn: any) {
  try { console.log(`  ${label} ->`, fn()); return fn(); }
  catch (e: any) { console.log(`  ${label} FAILED: ${e?.message ?? e}`); return null; }
}

// typed objc_msgSend through message.h
const typed = tryCC("objc/message.h typed cast", join(dir, "objc_message_typed.c"), {
  send_description: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
});
if (typed) call("send_description", () => typed.symbols.send_description(0, 0));

// e2e
const e2e = tryCC("objc e2e", join(dir, "objc_e2e.c"), {
  probe_e2e: { args: [], returns: FFIType.ptr },
  probe_class_only: { args: [], returns: FFIType.ptr },
  probe_utf8_length: { args: [FFIType.ptr], returns: FFIType.long },
  probe_utf8_equals: { args: [FFIType.ptr, FFIType.cstring], returns: FFIType.int },
});
if (e2e) {
  const d = call("probe_e2e (description)", () => e2e.symbols.probe_e2e());
  call("probe_class_only", () => e2e.symbols.probe_class_only());
  if (d) {
    call("utf8 length of description", () => e2e.symbols.probe_utf8_length(d));
    call("utf8 equals '<NSObject>'", () => e2e.symbols.probe_utf8_equals(d, "<NSObject>"));
    call("utf8 equals wrong", () => e2e.symbols.probe_utf8_equals(d, "nope"));
  }
}

// what options does cc accept? try a bogus one to see if it errors
try {
  (cc as any)({ source: join(dir, "flags_probe.c"), symbols: { compute: { args: [FFIType.int], returns: FFIType.int } }, bogusOption: true });
  console.log("PASS bogus option accepted silently");
} catch (e: any) { console.log("bogus option ->", e.message); }

// guess at flag-ish options
for (const key of ["flags", "cflags", "args", "options", "defines", "libraries", "libs", "frameworks", "include", "includes", "I", "L", "l"]) {
  const extra: any = { symbols: { compute: { args: [FFIType.int], returns: FFIType.int } } };
  extra[key] = ["-framework", "AppKit"];
  try {
    const r: any = (cc as any)({ source: join(dir, "flags_probe.c"), ...extra });
    console.log(`PASS option "${key}" accepted`);
  } catch (e: any) {
    console.log(`FAIL option "${key}" -> ${e.message}`);
  }
}

// appkit include
tryCC("appkit include", join(dir, "appkit_include.c"), {
  appkit_nsapp_class: { args: [], returns: FFIType.ptr },
  appkit_string_class: { args: [], returns: FFIType.ptr },
});
process.exit(0);