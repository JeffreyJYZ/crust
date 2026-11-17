/**
 * The macOS push half of `crust:power`: the two `NSNotificationCenter` observers and the single
 * `JSCallback` they report through. The C unit (`116_power_events.c`, joined with the battery unit)
 * builds one runtime `NSObject` subclass whose two selectors call one function pointer carrying a
 * scalar kind, so no object and no block ever crosses `bun:ffi`.
 * One trampoline per process: C holds a single sink pointer, so a second `JSCallback` would never be
 * reached. Re-subscribing a kind replaces its listener rather than stacking duplicates.
 */

import { FFIType, JSCallback } from "bun:ffi";
import { powerUnit, type PowerUnit } from "./power-ffi.ts";

/** The kinds the C unit reports; keep in step with PW_SLEEP / PW_LOCK in the shim. */
export const POWER_EVENT_KIND = { sleep: 1, lock: 2 } as const;

export interface DarwinPowerEvents {
	onSleep(listener: () => void): boolean;
	onLock(listener: () => void): boolean;
}

function pointerOf(callback: JSCallback): number {
	const raw: unknown = callback.ptr;
	const value = typeof raw === "number" ? raw : typeof raw === "bigint" ? Number(raw) : 0;
	if (value === 0) throw new Error("crust: JSCallback exposed no usable pointer");
	return value;
}

/**
 * Build the event channel. `unit` is a seam so a test can supply a fake symbol table without
 * compiling C or registering a real notification observer.
 */
export function darwinPowerEvents(
	unit: () => PowerUnit = powerUnit,
): DarwinPowerEvents & { fire(kind: number): void } {
	const listeners = new Map<number, () => void>();
	let channel: JSCallback | undefined;

	/** The one dispatch path, shared by the native trampoline and the test seam. */
	const dispatch = (kind: number): number => {
		const listener = listeners.get(Number(kind));
		if (listener === undefined) return 0;
		try {
			listener();
		} catch {
			// An exception crossing back into AppKit aborts the process.
		}
		return 0;
	};

	const ensure = (): void => {
		if (channel !== undefined) return;
		channel = new JSCallback((rawKind: number) => dispatch(Number(rawKind)), {
			args: [FFIType.i32],
			returns: FFIType.i32,
		});
		unit().symbols.crust_power_set_sink(pointerOf(channel));
	};

	const arm = (kind: number, listener: () => void): boolean => {
		listeners.set(kind, listener);
		ensure();
		return Number(unit().symbols.crust_power_watch(kind) ?? 0) === 1;
	};

	return {
		onSleep: (listener) => arm(POWER_EVENT_KIND.sleep, listener),
		onLock: (listener) => arm(POWER_EVENT_KIND.lock, listener),
		/** Test seam: drive the same dispatch the trampoline uses, without a real notification. */
		fire: (kind) => {
			dispatch(kind);
		},
	};
}
