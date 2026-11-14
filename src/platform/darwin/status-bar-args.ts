/**
 * Marshalling between JavaScript values and the pointers `status_bar/*.c` takes. Nothing here knows what a status item is: it is the argument and return-value discipline every call in `status-bar-item.ts` and `status-bar-readback.ts` shares.
 */

import { ptr } from "bun:ffi";

// A JS string cannot be passed into compiled C, so a `const char *` parameter
// gets an encoded buffer whose bytes stay reachable for the process lifetime.
const buffers = new Set<Uint8Array>();
const cbufCache = new Map<string, { p: number; len: number }>();

/** An encoded, NUL-terminated view of `s` and its byte length without the NUL. */
export function cbuf(s: string): { p: number; len: number } {
	let cached = cbufCache.get(s);
	if (cached === undefined) {
		const bytes = new TextEncoder().encode(`${s}\0`);
		buffers.add(bytes);
		cached = { p: ptr(bytes), len: bytes.length - 1 };
		cbufCache.set(s, cached);
	}
	return cached;
}

// A pointer arrives from bun:ffi as an exact number. Anything else is a 64-bit
// integer return (BigInt) or a missing symbol; refuse it rather than coerce it,
// because a mangled pointer faults at 0x10 later on.
export function ptrValue(v: unknown, what: string): number {
	if (typeof v === "number") return v;
	if (v === undefined) throw new Error(`${what} returned undefined`);
	throw new Error(`${what} returned ${typeof v}, not an exact pointer`);
}

/** Turn a C `1`/`0` into a typed failure naming the call AppKit refused. */
export function checked(v: unknown, what: string): void {
	const status = Number(v ?? 0);
	if (status !== 1) {
		throw new Error(`crust: ${what} was refused by AppKit (a selector it needs is absent)`);
	}
}
