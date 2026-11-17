/**
 * The power unit's C boundary: `shim/105_power.c` (battery, idle, assertion) joined with
 * `shim/116_power_events.c` (the sleep and lock notification observers) into one translation unit,
 * compiled by `cc()` with IOKit, CoreGraphics, Foundation, CoreFoundation and AppKit linked by name —
 * no artifact, no header. AppKit supplies `NSWorkspace`, whose center posts the sleep notification.
 * The shim's four rules hold here: no framework header, no object and no struct across `bun:ffi`,
 * every string arriving as bytes, and one fixed prototype per call. This file knows symbols and
 * buffers only; what a battery or a notification means belongs to `power.ts`.
 */

import { cc, FFIType, ptr } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A compiled binary has no readable `import.meta.dir`, so the C units travel inside it as text.
import powerPart from "./shim/105_power.c" with { type: "text" };
import eventsPart from "./shim/116_power_events.c" with { type: "text" };

/** The two halves as one translation unit; the events half uses the battery half's CFString helper. */
export const powerSource = [powerPart, eventsPart].join("\n");

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;
const F64 = FFIType.f64;
const CS = FFIType.cstring;
const V = FFIType.void;

/** Every symbol the unit declares, so a probe can prove the whole set resolved. */
export const POWER_SYMBOL_NAMES = [
	"crust_power_abi",
	"crust_power_reason",
	"crust_power_state",
	"crust_power_idle_seconds",
	"crust_power_held",
	"crust_power_prevent_sleep",
	"crust_power_allow_sleep",
	"crust_power_set_sink",
	"crust_power_watch",
	"crust_power_event_class_ready",
] as const;

/** The exports, as `bun:ffi` hands them back. */
export interface PowerUnit {
	symbols: {
		crust_power_abi: () => number;
		crust_power_reason: () => string | null;
		/** Writes onAc, the battery percentage and the low-power flag into three doubles. */
		crust_power_state: (out: number) => number;
		crust_power_idle_seconds: () => number;
		crust_power_held: () => number;
		crust_power_prevent_sleep: (bytes: number, length: number) => number;
		crust_power_allow_sleep: () => number;
		/** Register the one JS trampoline the two native notification callbacks share. */
		crust_power_set_sink: (sink: number) => void;
		/** 1 when the observer for that kind (1 sleep, 2 lock, 3 wake, 4 screensleep, 5 screenwake,
		 * 6 unlock) is registered, else 0. */
		crust_power_watch: (kind: number) => number;
		/** 1 when the runtime observer class carries every notification callback, else 0. */
		crust_power_event_class_ready: () => number;
	};
}

/** Content-hashed, so a second launch reuses the file and TinyCC's cache. */
function sourcePath(): string {
	const hash = createHash("sha256").update(powerSource).digest("hex").slice(0, 16);
	const file = join(tmpdir(), `crust-power-${hash}.c`);
	if (!existsSync(file)) writeFileSync(file, powerSource);
	return file;
}

function compile(): PowerUnit {
	return cc({
		source: sourcePath(),
		flags: [
			"-framework",
			"IOKit",
			"-framework",
			"CoreGraphics",
			"-framework",
			"Foundation",
			"-framework",
			"CoreFoundation",
			"-framework",
			"AppKit",
		],
		symbols: {
			crust_power_abi: { args: [], returns: I32 },
			crust_power_reason: { args: [], returns: CS },
			crust_power_state: { args: [P], returns: I32 },
			crust_power_idle_seconds: { args: [], returns: F64 },
			crust_power_held: { args: [], returns: I32 },
			crust_power_prevent_sleep: { args: [P, I64], returns: I32 },
			crust_power_allow_sleep: { args: [], returns: I32 },
			crust_power_set_sink: { args: [P], returns: V },
			crust_power_watch: { args: [I32], returns: I32 },
			crust_power_event_class_ready: { args: [], returns: I32 },
		},
	}) as unknown as PowerUnit;
}

let unitOnce: PowerUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function powerUnit(): PowerUnit {
	return (unitOnce ??= compile());
}

/** Whether the unit compiled and every declared export resolved. Nothing is asserted. */
export function powerUnitStatus(): { available: boolean; reason: string } {
	try {
		const compiled = powerUnit();
		return Number(compiled.symbols.crust_power_abi()) === 1
			? { available: true, reason: "compiled" }
			: { available: false, reason: "crust_power_abi did not answer 1" };
	} catch (error) {
		return { available: false, reason: error instanceof Error ? error.message : String(error) };
	}
}

// A strong reference for the duration of one send: `bun:ffi` reads the bytes during the call, and a
// local `Uint8Array` may be collected before it returns.
let pinned: Uint8Array | undefined;

/** A JS string as the byte range the C side builds a `CFString` from. */
export function bytesOf(text: string): { address: number; length: number } {
	const bytes = new TextEncoder().encode(text);
	pinned = bytes;
	return { address: ptr(bytes), length: bytes.length };
}

/** The three-double buffer and its address, so the adapter never imports `bun:ffi`. */
export function stateOut(): { values: Float64Array; address: number } {
	const values = new Float64Array(3);
	return { values, address: ptr(values) };
}
