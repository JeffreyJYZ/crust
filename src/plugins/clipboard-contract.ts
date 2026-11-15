/**
 * The `crust:clipboard` contract: what a command answers, what the native half must provide, and the small pure builders both command modules return. Kept apart from the commands so a platform half imports the types without dragging the plugin's behaviour in.
 */

import { notImplemented, type NotImplemented } from "./define";

/** What the native half reports about a write. Only `written` means it landed. */
export type ClipboardWriteVerdict = "written" | "refused" | "missing";

/** Why a clipboard command could not answer. */
export type ClipboardErrorCode =
	"bad-request" | "unknown-adapter" | "write-failed" | "handler-error";

/** The typed failure a command returns instead of throwing. */
export interface ClipboardFailure {
	readonly ok: false;
	readonly code: ClipboardErrorCode;
	readonly message: string;
}

export interface ClipboardReadResult {
	readonly ok: true;
	/** The pasteboard's text, `""` when it holds none. */
	readonly text: string;
}

export interface ClipboardImageReadResult {
	readonly ok: true;
	/** PNG bytes, `null` when the pasteboard holds no image. */
	readonly png: Uint8Array | null;
}

export interface ClipboardWriteResult {
	readonly ok: true;
	readonly written: true;
}

export type ClipboardImageWriteResult = ClipboardWriteResult;

/**
 * The native half of `crust:clipboard`. A read answers the empty value for an
 * empty pasteboard and `null` when there is no pasteboard to read; a write
 * answers the pasteboard's own verdict rather than the adapter's optimism.
 */
export interface ClipboardAdapter {
	readText(): string | null;
	writeText(text: string): ClipboardWriteVerdict;
	readImage(): Uint8Array | null;
	writeImage(png: Uint8Array): ClipboardWriteVerdict;
}

export interface ClipboardWriteArgs {
	text: string;
}

export interface ClipboardWriteImageArgs {
	png: Uint8Array;
}

/** `clipboard.read` takes no arguments; the shape exists so a client can type it. */
export type ClipboardReadArgs = Record<string, never>;

/** The eight bytes every PNG starts with; anything else is refused unread. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Whether these bytes are a PNG, judged by its magic number alone. */
export function isPng(bytes: Uint8Array): boolean {
	if (bytes.length < PNG_MAGIC.length) return false;
	return PNG_MAGIC.every((byte, index) => bytes[index] === byte);
}

/** The honest answer for a platform with no pasteboard at all. */
export function missingCommand(command: string): NotImplemented {
	return notImplemented(
		`clipboard.${command} needs the general pasteboard: NSPasteboard's -stringForType: and -setString:forType: for text, -readObjectsForClasses:options: with NSImage and -representationUsingType:properties: for PNG, are AppKit, and this platform has no adapter for them. Pass a ClipboardAdapter to createClipboardPlugin when one is reachable.`,
		"NSPasteboard",
	);
}

export function unknownAdapter(method: string): ClipboardFailure {
	return {
		ok: false,
		code: "unknown-adapter",
		message: `crust: clipboard adapter does not implement ${method}`,
	};
}

export function handlerFailure(error: unknown): ClipboardFailure {
	return {
		ok: false,
		code: "handler-error",
		message: error instanceof Error ? error.message : String(error),
	};
}

/** The pasteboard's verdict as a result, shared by both writes. */
export function writeOutcome(
	command: string,
	kind: string,
	verdict: ClipboardWriteVerdict,
): ClipboardWriteResult | ClipboardFailure | NotImplemented {
	if (verdict === "written") return { ok: true, written: true };
	if (verdict === "missing") return missingCommand(command);
	return {
		ok: false,
		code: "write-failed",
		message: `clipboard.${command}: the general pasteboard did not take the ${kind} (${String(verdict)})`,
	};
}
