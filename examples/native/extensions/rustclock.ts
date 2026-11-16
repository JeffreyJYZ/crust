/**
 * rustclock — `clock.rs` compiled to a cdylib, called through `bun:ffi`.
 *
 * The twin of `zigclock.ts`, and deliberately identical above the bindings: `rustc` prefixes a
 * cdylib with `lib`, so `generated/rustclock.ts` opens `libclock.dylib` instead of `clock.dylib`.
 * The extension's shape does not change, which is the point of the generated half.
 */
import { nativeClock } from "./clock-shared.ts";
import * as rust from "./generated/rustclock.ts";

export default nativeClock({
	name: "rustclock",
	flavor: "rust",
	native: { nowMs: rust.now_ms, ranFor: rust.ran_for_ms, ticksBetween: rust.ticks_between },
});
