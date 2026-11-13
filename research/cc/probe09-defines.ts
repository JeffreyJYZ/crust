// probe09: which cc option shapes actually apply? read the error text carefully.
import { cc, FFIType } from "bun:ffi";
import { join } from "node:path";
const dir = new URL("./c/", import.meta.url).pathname;

const syms = {
  with_extra: { args: [], returns: FFIType.int },
  always: { args: [FFIType.int], returns: FFIType.int },
};

type Shape = [string, any];
const shapes: Shape[] = [
  ["defines string", "CRUST_EXTRA"],
  ["defines array", ["CRUST_EXTRA"]],
  ["defines obj", { CRUST_EXTRA: "1" }],
  ["defines map", { CRUST_EXTRA: 1 }],
  ["define string", "-DCRUST_EXTRA"],
  ["D string", "-DCRUST_EXTRA"],
  ["D array", ["-DCRUST_EXTRA"]],
  ["D array noDash", ["CRUST_EXTRA"]],
  ["defines with -D", ["-DCRUST_EXTRA"]],
  ["flags -D", ["-DCRUST_EXTRA"]],
];

for (const [label, val] of shapes) {
  const key = label.split(" ")[0];
  const keyMap: Record<string, string> = { defines: "defines", define: "define", D: "D", flags: "flags" };
  const k = keyMap[key] ?? key;
  try {
    const r: any = (cc as any)({ source: join(dir, "define_probe.c"), symbols: syms, [k]: val });
    let got = "?";
    try { got = String(r.symbols.with_extra()); } catch (e: any) { got = "call-err:" + e.message; }
    console.log(`PASS ${label} [${k}] with_extra=${got}`);
  } catch (e: any) {
    console.log(`FAIL ${label} [${k}] ${e.message.replace(/\n/g, " | ")}`);
  }
}
process.exit(0);