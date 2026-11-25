/**
 * Marshalling between JavaScript values and the pointers `status_bar/*.c` takes. Nothing here knows what a status item is: it is the argument and return-value discipline every call in `status-bar-item.ts` and `status-bar-readback.ts` shares.
 */

import { ptr } from "bun:ffi";

// A JS string cannot be passed into compiled C, so a `const char *` parameter gets an encoded
// buffer. Every send is synchronous and C copies the bytes, so a buffer only has to stay alive for
// the duration of one call. An unbounded cache turned distinct page labels into a process-lifetime
// heap leak; keep only a small recent window, which is also enough for exact-repeat callers.
/** How many encoded strings stay reachable at once. */
export const CBUF_LIMIT = 64;
const cbufCache = new Map<string, { p: number; len: number; bytes: Uint8Array }>();

/** An encoded, NUL-terminated view of `s` and its byte length without the NUL. */
export function cbuf(s: string): { p: number; len: number } {
	let cached = cbufCache.get(s);
	if (cached === undefined) {
		const bytes = new TextEncoder().encode(`${s}\0`);
		cached = { p: ptr(bytes), len: bytes.length - 1, bytes };
		cbufCache.set(s, cached);
		if (cbufCache.size > CBUF_LIMIT) {
			const oldest = cbufCache.keys().next().value;
			if (oldest !== undefined) cbufCache.delete(oldest);
		}
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
