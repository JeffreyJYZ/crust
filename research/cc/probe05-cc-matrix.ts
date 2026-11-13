// probe05: cc() compile matrix. Each case exits; whole file exits.
import { cc, FFIType, CString, ptr } from "bun:ffi";
import { join } from "node:path";

const dir = new URL("./c/", import.meta.url).pathname;
const t0 = performance.now();

function tryCC(label: string, source: string, symbols?: any, extra?: any) {
  const s = performance.now();
  try {
    const res: any = (cc as any)({ source, symbols, ...extra });
    const ms = (performance.now() - s).toFixed(2);
    console.log(`PASS ${label} [${ms}ms] symbols=${Object.keys(res.symbols).join(",")}`);
    return res;
  } catch (e: any) {
    const ms = (performance.now() - s).toFixed(2);
    console.log(`FAIL ${label} [${ms}ms] ${e?.message ?? e}`);
    return null;
  }
}

// 1. baseline
const basic = tryCC("basic", join(dir, "basic.c"), {
  add: { args: [FFIType.int, FFIType.int], returns: FFIType.int },
  greet: { args: [], returns: FFIType.cstring },
});
if (basic) {
  console.log("  add(2,3) =", basic.symbols.add(2, 3));
  console.log("  greet()  =", new CString(basic.symbols.greet()));
}

// 2. headers
const hdr = tryCC("headers(stdlib,string)", join(dir, "headers.c"), {
  use_headers: { args: [FFIType.int], returns: FFIType.int },
});
if (hdr) console.log("  use_headers(16) =", hdr.symbols.use_headers(16));

const hdrio = tryCC("headers(stdio)", join(dir, "headers_io.c"), {
  headers_io: { args: [], returns: FFIType.int },
});
if (hdrio) console.log("  headers_io() =", hdrio.symbols.headers_io());

// 3a. extern variadic decl
const objcExt = tryCC("objc extern variadic", join(dir, "objc_extern.c"), {
  call_description: { args: [], returns: FFIType.ptr },
  call_class: { args: [], returns: FFIType.ptr },
});
if (objcExt) {
  try {
    const d = objcExt.symbols.call_description();
    console.log("  description ptr =", d);
  } catch (e: any) { console.log("  call FAILED:", e.message); }
}

// 3b. objc/message.h
tryCC("objc message.h", join(dir, "objc_message_h.c"), {
  call_description: { args: [], returns: FFIType.ptr },
});

// 3c. pointer params
const objcPtr = tryCC("objc pointer params", join(dir, "objc_ptrparam.c"), {
  call_description: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
});

// 4. appkit include
tryCC("appkit include", join(dir, "appkit_include.c"), {});

process.exit(0);