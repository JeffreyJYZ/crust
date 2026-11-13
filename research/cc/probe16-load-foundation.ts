// probe16: does dlopen'ing Foundation make the classes appear? and does -framework load it?
import { dlopen, FFIType } from "bun:ffi";

const base = dlopen("/usr/lib/libobjc.A.dylib", {
  objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
});
const send = dlopen("/usr/lib/libobjc.A.dylib", {
  objc_msgSend: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
});
console.log("--- before Foundation load ---");
for (const n of ["NSObject", "NSString", "NSApplication", "NSWindow"]) console.log(" ", n, base.symbols.objc_getClass(n));

const f = dlopen("/System/Library/Frameworks/Foundation.framework/Foundation", { __crust_probe: { args: [], returns: FFIType.ptr } } as any);
console.log("dlopen Foundation:", Object.keys((f as any).symbols).join(","));
console.log("--- after Foundation load ---");
for (const n of ["NSObject", "NSString", "NSApplication", "NSWindow"]) console.log(" ", n, base.symbols.objc_getClass(n));

const sel = (s: string) => base.symbols.objc_getClass ? (dlopen("/usr/lib/libobjc.A.dylib", { sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr } }).symbols.sel_registerName(s)) : 0;
const sreg = dlopen("/usr/lib/libobjc.A.dylib", { sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr } }).symbols.sel_registerName;
const msg = (r: any, s: string, ...a: any[]) => send.symbols.objc_msgSend(r, sreg(s), ...a);
const NSObject = base.symbols.objc_getClass("NSObject");
const o = msg(msg(NSObject, "alloc"), "init");
console.log("description =", msg(o, "description"));
console.log("class       =", msg(o, "class"));
process.exit(0);