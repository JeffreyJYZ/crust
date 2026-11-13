import { FFIType } from "bun:ffi";
console.log("FFIType keys:", Object.keys(FFIType).join(","));
for (const k of Object.keys(FFIType)) {
  const v = (FFIType as any)[k];
  if (typeof v !== "number") console.log("  non-number", k, typeof v, String(v));
}
process.exit(0);