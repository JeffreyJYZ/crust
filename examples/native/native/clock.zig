//! clock — the Zig half of the `zigclock` extension.
//!
//! The three exports are the whole C ABI. `f64` and `u32` cross `bun:ffi` directly, so no struct
//! and no string is handed over: the TypeScript half owns state and formatting, this file owns the
//! clock arithmetic. `clock.rs` exports the same three names with the same signatures, so one
//! generated bindings module describes both dylibs.
// Zig 0.17's `std.time` carries only unit constants and the epoch calendar — it has no wall-clock
// reading (`std.time.milliTimestamp` is gone), so the epoch time comes from libc, which every macOS
// dylib links anyway. `gettimeofday` rather than `clock_gettime`: one struct of two integers, and no
// feature-test macro to argue with.
const Timeval = extern struct { sec: c_long, usec: c_int };

extern "c" fn gettimeofday(tv: *Timeval, tz: ?*anyopaque) c_int;

/// Epoch milliseconds as a float, which is what `bun:ffi` hands back for `f64`.
export fn now_ms() f64 {
	var tv: Timeval = .{ .sec = 0, .usec = 0 };
	if (gettimeofday(&tv, null) != 0) return 0;
	const sec: f64 = @floatFromInt(tv.sec);
	const usec: f64 = @floatFromInt(tv.usec);
	return sec * 1000 + usec / 1000;
}

/// How long a run lasted, clamped at zero so a clock that moved backwards reports nothing.
export fn ran_for_ms(started_ms: f64, at_ms: f64) f64 {
	const elapsed = at_ms - started_ms;
	return if (elapsed > 0) elapsed else 0;
}

/// Ticks a timer of `every_ms` emitted since `started_ms`; zero for a bad interval.
export fn ticks_between(started_ms: f64, every_ms: f64, at_ms: f64) u32 {
	if (every_ms <= 0) return 0;
	const count = ran_for_ms(started_ms, at_ms) / every_ms;
	if (count < 1) return 0;
	if (count > 1_000_000) return 1_000_000;
	return @intFromFloat(count);
}
