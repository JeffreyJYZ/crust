// probe00: what does bun:ffi actually export on this Bun?
import * as ffi from "bun:ffi";
console.log("bun", Bun.version, "rev", Bun.revision);
console.log("exports:", Object.keys(ffi).sort().join(", "));
console.log("typeof cc:", typeof (ffi as any).cc);
console.log("typeof CString:", typeof (ffi as any).CString);
console.log("cc.length (arity):", (ffi as any).cc?.length);
console.log("cc source head:", String((ffi as any).cc).slice(0, 400));
process.exit(0);