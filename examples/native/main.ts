/**
 * The backend half of the native example, and the shortest possible proof that a dylib loaded:
 * it calls the generated `bun:ffi` modules directly, before any page exists, and prints what the
 * native code answered. The page half is `public/app.js`, which reaches the same dylibs through
 * the extension commands over the bridge.
 *
 * Nothing here registers an extension — `crust dev` does that from `crust.config.ts`.
 *
 * Run it with `bun run src/cli/index.ts dev --dir examples/native` from the repository root, after
 * `bun run build:native` has written `extensions/generated/`.
 */
import { app } from "crust";
import * as rust from "./extensions/generated/rustclock.ts";
import * as zig from "./extensions/generated/zigclock.ts";

// Both numbers are epoch milliseconds from the dylib itself, so a real dlopen happened twice.
console.log(`  direct zig   ${zig.now_ms()}`);
console.log(`  direct rust  ${rust.now_ms()}`);
// One arithmetic call each, so the exported symbols beyond the clock reading are exercised too.
console.log(`  zig ticks    ${zig.ticks_between(0, 1000, 3500)}`);
console.log(`  rust ticks   ${rust.ticks_between(0, 1000, 3500)}`);

await app.run();
