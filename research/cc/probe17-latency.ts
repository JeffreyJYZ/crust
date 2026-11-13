// probe17: compile latency. cold in this process, warm repeat, and cross-process cold.
import { cc, FFIType } from "bun:ffi";
import { join } from "node:path";
const dir = new URL("./c/", import.meta.url).pathname;

const syms = { compute: { args: [FFIType.int], returns: FFIType.int } };

function compileOnce(label: string) {
  const s = performance.now();
  try {
    const r: any = (cc as any)({ source: join(dir, "flags_probe.c"), symbols: syms });
    const ms = performance.now() - s;
    const v = r.symbols.compute(21);
    console.log(`${label}: ${ms.toFixed(3)}ms (compute(21)=${v})`);
    try { r.close?.(); } catch {}
    return ms;
  } catch (e: any) {
    console.log(`${label}: FAIL ${e.message}`);
    return NaN;
  }
}

const times: number[] = [];
for (let i = 0; i < 6; i++) times.push(compileOnce(`run#${i}`));

// a different, larger source, to see if cost tracks size
const s2 = performance.now();
const big: any = (cc as any)({ source: join(dir, "framework_e2e.c"), symbols: { description_len: { args: [], returns: FFIType.int } }, flags: ["-framework", "Foundation"] });
console.log(`objc+Foundation compile: ${(performance.now() - s2).toFixed(3)}ms (description_len=${big.symbols.description_len()})`);

console.log(`first: ${times[0].toFixed(3)}ms  median-of-rest: ${times.slice(1).sort((a, b) => a - b)[Math.floor((times.length - 1) / 2)].toFixed(3)}ms`);
process.exit(0);