/**
 * The native half of `crust:clipboard` on macOS: `NSPasteboard` over `bun:ffi`, in its own C unit — `shim/90_clipboard.c` for text, `shim/101_clipboard_image.c` for images — because the window shim's parts are assembled in `shim-source.ts` and this one must also compile alone.
 * **Nothing but bytes crosses.** A read copies into a caller-sized buffer and reports the full length, so a long pasteboard or a big image is re-read at its exact size instead of being silently truncated; a write encodes UTF-8 or hands over PNG bytes, and every `NSString`/`NSImage`/`NSData` stays in C, because a short ASCII `NSString` is a tagged pointer that cannot survive `bun:ffi`. Nothing is sent on trust: `-generalPasteboard` and every selector are guarded in C, since an uncaught Objective-C exception kills the process with no JavaScript error.
 */

import { cc, FFIType, ptr } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ClipboardAdapter, ClipboardWriteVerdict } from "@/plugins/clipboard";

// A compiled binary has no `import.meta.dir`, so the C parts travel inside the
// binary as text and are materialised before `cc()` sees them.
import clipboardTextSource from "./shim/90_clipboard.c" with { type: "text" };
import clipboardImageSource from "./shim/101_clipboard_image.c" with { type: "text" };

/** One unit: the image part carries only `img_*` statics, so the join is safe. */
const UNIT_SOURCE = `${clipboardTextSource}\n${clipboardImageSource}`;

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;

/** The six exports, as `bun:ffi` hands them back. */
export interface ClipboardUnit {
	symbols: {
		shim_clipboard_available: () => number;
		shim_clipboard_read: (dst: number, cap: number) => number;
		shim_clipboard_write: (bytes: number, length: number) => number;
		shim_clipboard_image_available: () => number;
		shim_clipboard_image_read: (dst: number, cap: number) => number;
		shim_clipboard_image_write: (bytes: number, length: number) => number;
	};
}

function compile(): ClipboardUnit {
	/** Content-hashed, so a second launch reuses the file and TinyCC's cache. */
	function sourcePath(): string {
		const hash = createHash("sha256").update(UNIT_SOURCE).digest("hex").slice(0, 16);
		const file = join(tmpdir(), `crust-clipboard-${hash}.c`);
		if (!existsSync(file)) writeFileSync(file, UNIT_SOURCE);
		return file;
	}

	return cc({
		source: sourcePath(),
		flags: ["-framework", "AppKit", "-framework", "Foundation"],
		symbols: {
			shim_clipboard_available: { args: [], returns: I32 },
			shim_clipboard_read: { args: [P, I64], returns: I64 },
			shim_clipboard_write: { args: [P, I64], returns: I32 },
			shim_clipboard_image_available: { args: [], returns: I32 },
			shim_clipboard_image_read: { args: [P, I64], returns: I64 },
			shim_clipboard_image_write: { args: [P, I64], returns: I32 },
		},
	}) as unknown as ClipboardUnit;
}

let unitOnce: ClipboardUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function clipboardUnit(): ClipboardUnit {
	return (unitOnce ??= compile());
}

/**
 * The C half, named so a test can drive the adapter with a fake and wide enough
 * that the real one has the same shape. Every method compiles on call, not when
 * this object is built, so importing the adapter never builds the unit.
 */
export interface ClipboardShim {
	/** 1 when AppKit answers every selector both parts send. */
	available(): boolean;
	/** UTF-8 bytes into `into`, the full length, 0 for empty text, -1 for no pasteboard. */
	read(into: Uint8Array): number;
	/** 1 written, 0 refused, -1 missing — `-setString:forType:`'s own verdict. */
	write(bytes: Uint8Array, length: number): number;
	/** PNG bytes into `into`, the full length, 0 for no image, -1 for no pasteboard. */
	readImage(into: Uint8Array): number;
	/** 1 written, 0 refused, -1 missing — `-setData:forType:`'s own verdict. */
	writeImage(bytes: Uint8Array, length: number): number;
}

/** The real shim: one call per method, buffers built here. */
export function darwinClipboardShim(): ClipboardShim {
	const unit = () => clipboardUnit().symbols;
	return {
		available: () =>
			Number(unit().shim_clipboard_available() ?? 0) === 1 &&
			Number(unit().shim_clipboard_image_available() ?? 0) === 1,
		read: (into) => Number(unit().shim_clipboard_read(ptr(into), into.length) ?? -1),
		write: (bytes, length) => Number(unit().shim_clipboard_write(ptr(bytes), length) ?? -1),
		readImage: (into) => Number(unit().shim_clipboard_image_read(ptr(into), into.length) ?? -1),
		writeImage: (bytes, length) =>
			Number(unit().shim_clipboard_image_write(ptr(bytes), length) ?? -1),
	};
}

/**
 * Compile the unit and report whether AppKit serves it. Nothing is read or
 * written, so this is test-safe: it never touches the user's clipboard and needs
 * no window, which is why it is the one native assertion the suite makes.
 */
export function clipboardUnitStatus(): { available: boolean; reason: string } {
	try {
		const { symbols } = clipboardUnit();
		const text = Number(symbols.shim_clipboard_available() ?? 0) === 1;
		const image = Number(symbols.shim_clipboard_image_available() ?? 0) === 1;
		if (text && image) return { available: true, reason: "compiled" };
		return {
			available: false,
			reason: text
				? "AppKit does not answer a selector the image part sends"
				: "NSPasteboard does not answer a selector the text part sends",
		};
	} catch (error) {
		return { available: false, reason: error instanceof Error ? error.message : String(error) };
	}
}

/** The first buffer size; anything longer is re-read at its exact length. */
export const READ_CHUNK = 64 * 1024;

/** The same for image bytes, which run far larger than most clipboard text. */
export const IMAGE_CHUNK = 1024 * 1024;

/** `-1` refused, `1` written — the C status as the plugin's three-valued verdict. */
function verdict(status: number): ClipboardWriteVerdict {
	if (status === 1) return "written";
	if (status === -1) return "missing";
	return "refused";
}

/** Build the clipboard adapter. The unit compiles on the first command, not before. */
export function darwinClipboardAdapter(
	/** The clipboard shim; overridable so a test can drive this with fakes. */
	native: ClipboardShim = darwinClipboardShim(),
): ClipboardAdapter {
	const readText = (): string | null => {
		let buffer = new Uint8Array(READ_CHUNK);
		let length = native.read(buffer);
		if (length < 0) return null;
		// The buffer was too small for the text, so ask again with an exact one
		// rather than handing back a truncated clipboard.
		if (length > buffer.length - 1) {
			buffer = new Uint8Array(length + 1);
			length = native.read(buffer);
			if (length < 0) return null;
		}
		// A pasteboard edited between the two calls can still overrun the second
		// buffer; the clamp is a race guard, not the normal path.
		const bytes = Math.min(length, buffer.length - 1);
		return new TextDecoder().decode(buffer.subarray(0, bytes));
	};

	const writeText = (text: string): ClipboardWriteVerdict => {
		// The trailing NUL keeps the buffer non-empty, so an empty write still hands
		// C a real pointer and `-initWithBytes:length:0` builds the empty string.
		const bytes = new TextEncoder().encode(`${text}\0`);
		return verdict(native.write(bytes, bytes.length - 1));
	};

	/** Two passes for the same reason as text: the length first, then the bytes. */
	const readImage = (): Uint8Array | null => {
		let buffer = new Uint8Array(IMAGE_CHUNK);
		let length = native.readImage(buffer);
		if (length < 0) return null;
		if (length === 0) return new Uint8Array(0);
		if (length > buffer.length) {
			buffer = new Uint8Array(length);
			length = native.readImage(buffer);
			if (length < 0) return null;
			if (length === 0) return new Uint8Array(0);
		}
		// The same race guard as text: an image swapped between the two calls.
		return buffer.slice(0, Math.min(length, buffer.length));
	};

	const writeImage = (png: Uint8Array): ClipboardWriteVerdict =>
		verdict(native.writeImage(png, png.length));

	return { readText, writeText, readImage, writeImage };
}
