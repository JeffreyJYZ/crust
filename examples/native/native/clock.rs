//! clock — the Rust half of the `rustclock` extension.
//!
//! The same three C symbols as `clock.zig`, with the same signatures, so the generated bindings
//! module and the TypeScript half are shared: the language under the dylib is invisible above
//! `bun:ffi`. No struct and no string crosses the boundary, only `f64` and `u32`.
use std::time::{SystemTime, UNIX_EPOCH};

fn epoch_ms() -> f64 {
	match SystemTime::now().duration_since(UNIX_EPOCH) {
		Ok(elapsed) => elapsed.as_secs_f64() * 1000.0,
		Err(_) => 0.0,
	}
}

#[no_mangle]
pub extern "C" fn now_ms() -> f64 {
	epoch_ms()
}

#[no_mangle]
pub extern "C" fn ran_for_ms(started_ms: f64, at_ms: f64) -> f64 {
	let elapsed = at_ms - started_ms;
	if elapsed > 0.0 {
		elapsed
	} else {
		0.0
	}
}

#[no_mangle]
pub extern "C" fn ticks_between(started_ms: f64, every_ms: f64, at_ms: f64) -> u32 {
	if every_ms <= 0.0 {
		return 0;
	}
	let count = ran_for_ms(started_ms, at_ms) / every_ms;
	if count < 1.0 {
		return 0;
	}
	if count > 1_000_000.0 {
		return 1_000_000;
	}
	count as u32
}
