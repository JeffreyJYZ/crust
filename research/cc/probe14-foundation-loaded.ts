// is Foundation already loaded in a bare Bun process? does msgSend(description) work via dlopen?
import { dlopen, FFIType, ptr } from "bun:ffi";

const base = dlopen("/usr/lib/libobjc.A.dylib", {
  objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
  sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
});
const send = dlopen("/usr/lib/libobjc.A.dylib", {
  objc_msgSend: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
});
console.log("--- bare process class lookups (no cc, no framework link) ---");
for (const n of ["NSObject", "NSString", "NSApplication", "NSWindow", "NSMutableString"]) {
  console.log(`  objc_getClass(${n}) =`, base.symbols.objc_getClass(n));
}
const sel = (s: string) => base.symbols.sel_registerName(s);
const NSObject = base.symbols.objc_getClass("NSObject");
const msg = (r: any, s: string, ...a: any[]) => send.symbols.objc_msgSend(r, sel(s), ...a);

console.log("--- alloc / init / description / class via 2-arg msgSend ---");
const alloc = msg(NSObject, "alloc");
console.log("  alloc       =", alloc);
const init = msg(alloc, "init");
console.log("  init        =", init);
console.log("  description =", msg(init, "description"));
console.log("  class       =", msg(init, "class"));
const NSString = base.symbols.objc_getClass("NSString");
console.log("  NSString    =", NSString);
if (NSString) {
  const s = msg(NSString, "stringWithUTF8String:", ptr(new TextEncoder().encode("hi")));
  console.log("  stringWithUTF8String:('hi') =", s);
  if (s) console.log("    UTF8String =", msg(s, "UTF8String"));
}
process.exit(0);