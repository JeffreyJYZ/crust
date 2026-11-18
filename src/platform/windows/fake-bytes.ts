/**
 * The three helpers both halves of the fake shim need: the text of a `cstring` argument, the encoder,
 * and the bytes at a raw address.
 *
 * `at` is what makes the clipboard half honest — a fake that answered only a length would hand the
 * adapter zeros, so it writes through the same memory the real shim writes through.
 */
import { toArrayBuffer } from "bun:ffi";

export const encoder = new TextEncoder();

/** The bytes at a raw pointer, as the caller's own buffer. */
export function at(address: number, length: number): Uint8Array {
	return new Uint8Array(toArrayBuffer(address as never, 0, length));
}

/** The UTF-8 a `cstring` argument carries, minus its terminator. */
export function text(value: Uint8Array): string {
	return Buffer.from(value).toString("utf8").replace(/\0$/, "");
}
