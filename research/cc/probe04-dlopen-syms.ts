// probe04: dlopen system libs with real symbols
import { dlopen, FFIType } from "bun:ffi";
const cases: [string, Record<string, any>][] = [
  ["/usr/lib/libobjc.A.dylib", { objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr }, sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr } }],
  ["/usr/lib/libobjc.dylib", { objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr } }],
  ["/usr/lib/libffi.dylib", { ffi_call: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.void } }],
  ["/System/Library/Frameworks/AppKit.framework/AppKit", { NSApplication: { args: [], returns: FFIType.ptr } } as any],
];
for (const [p, syms] of cases) {
  try {
    const h = dlopen(p, syms);
    console.log("PASS dlopen", p, "symbols:", Object.keys(h.symbols).join(","));
  } catch (e: any) {
    console.log("FAIL dlopen", p, "->", e.message);
  }
}
// And the pure-runtime call through it
try {
  const o = dlopen("/usr/lib/libobjc.A.dylib", {
    objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
    sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
    objc_msgSend: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  });
  const cls = o.symbols.objc_getClass("NSObject");
  console.log("objc_getClass(NSObject) =", cls);
} catch (e: any) {
  console.log("FAIL runtime-call ->", e.message);
}
process.exit(0);