/**
 * A NUL-terminated UTF-8 buffer for an `FFIType.cstring` argument.
 * `bun:ffi` refuses a JavaScript string at that argument — `bun:ffi: a JavaScript string is not
 * valid here; return it from a 'cstring'-returning callback, or pass a pointer/TypedArray` —
 * measured on Linux against real GTK, where the throw landed at `createWindow` before C ran, and
 * the same shape applies here. The trailing NUL is part of the contract: the C side reads a C
 * string, and a buffer without it over-reads.
 */
export function cstring(value: string): Uint8Array {
	// `MultiByteToWideChar(…, -1)` stops at the first NUL, so an embedded NUL silently dropped the
	// rest of the text while the surrounding Win32 call still reported success. Refuse it at the
	// encoding boundary instead of letting the caller believe the whole string was applied.
	if (value.includes("\0"))
		throw new Error(
			"crust: a Windows string contains an embedded NUL; Win32 would truncate it and still " +
				"report success, so the value was refused",
		);
	return Buffer.from(`${value}\0`, "utf8");
}
