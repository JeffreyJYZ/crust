// probe03: can we dlopen system libs that live only in the dyld shared cache?
import { dlopen } from "bun:ffi";
const candidates = [
  "/usr/lib/libobjc.A.dylib",
  "/usr/lib/libobjc.dylib",
  "/usr/lib/libffi.dylib",
  "/usr/lib/libffi-trampolines.dylib",
  "/System/Library/Frameworks/AppKit.framework/AppKit",
];
for (const p of candidates) {
  try {
    const h = dlopen(p, {});
    console.log("PASS dlopen", p, "->", String(h).slice(0, 80));
  } catch (e: any) {
    console.log("FAIL dlopen", p, "->", e.message);
  }
}
process.exit(0);