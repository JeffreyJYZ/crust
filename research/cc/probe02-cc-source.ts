// probe02: full cc() source + option surface
import { cc } from "bun:ffi";
console.log(String(cc));
console.log("=== try help/usage by calling with junk ===");
try {
  (cc as any)({});
} catch (e: any) {
  console.log("ERR:", e.message);
}
try {
  (cc as any)();
} catch (e: any) {
  console.log("ERR2:", e.message);
}
process.exit(0);