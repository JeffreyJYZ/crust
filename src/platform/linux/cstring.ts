/**
 * A NUL-terminated UTF-8 buffer for an `FFIType.cstring` argument.
 * bun:ffi refuses a JavaScript string at that argument — `a JavaScript string is not valid here; return it from a 'cstring'-returning callback, or pass a pointer/TypedArray` — measured on `ubuntu-sandbox` against real `libgtk-3.so.0`, where the throw arrived as `FAIL step 3/6 createWindow`. The trailing NUL is part of the contract: the C side reads a C string, and a buffer without it over-reads.
 */
export function cstring(value: string): Uint8Array {
	return Buffer.from(`${value}\0`, "utf8");
}
