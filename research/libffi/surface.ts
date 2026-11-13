import * as ffi from "bun:ffi";
console.log("exports:", Object.keys(ffi));
console.log("FFIType:", JSON.stringify(ffi.FFIType));
const lib = ffi.dlopen("/usr/lib/libffi.dylib", {
  ffi_prep_cif: { args: ["ptr", "int32", "uint32", "ptr", "ptr"], returns: "int32" },
  ffi_call: { args: ["ptr", "ptr", "ptr", "ptr"], returns: "void" },
});
console.log("symbol keys:", Object.keys(lib.symbols.ffi_call));
console.log("lib keys:", Object.keys(lib));
process.exit(0);
