/**
 * zigclock — `clock.zig` compiled to a dylib, called through `bun:ffi`.
 *
 * `generated/zigclock.ts` is written by `bun run build:native` (the repo's own `compileExtension`
 * plus `writeBindings`), and it dlopens `clock.dylib` from its own directory. Nothing here knows
 * Zig: the module exports `now_ms`, `ran_for_ms` and `ticks_between` as plain functions.
 */
import { nativeClock } from "./clock-shared.ts";
import * as zig from "./generated/zigclock.ts";

export default nativeClock({
	name: "zigclock",
	flavor: "zig",
	native: { nowMs: zig.now_ms, ranFor: zig.ran_for_ms, ticksBetween: zig.ticks_between },
});
