/**
 * A NUL-terminated UTF-8 buffer for an `FFIType.cstring` argument.
 * `bun:ffi` refuses a JavaScript string at that argument — `bun:ffi: a JavaScript string is not
 * valid here; return it from a 'cstring'-returning callback, or pass a pointer/TypedArray` —
 * measured on Linux against real GTK, where the throw landed at `createWindow` before C ran, and
 * the same shape applies here. The trailing NUL is part of the contract: the C side reads a C
 * string, and a buffer without it over-reads.
 */
export function cstring(value: string): Uint8Array {
	return Buffer.from(`${value}\0`, "utf8");
}
