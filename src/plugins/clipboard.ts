/**
 * `crust:clipboard` — plain text on the general pasteboard, the two commands Tauri's clipboard-manager exposes as `readText`/`writeText`. The plugin owns no framework: macOS supplies `darwinClipboardAdapter()` and a platform without one keeps answering a typed `NotImplemented` naming `NSPasteboard`, never an empty string that reads as "the clipboard is empty".
 * **A write is only `ok: true` when the pasteboard said it took the string.** `-setString:forType:` answers BOOL, so the adapter reports `written`, `refused` or `missing` and the plugin passes that verdict on; a refusal is a `ClipboardFailure` value, never a throw across the bridge. A read answers `""` for an empty pasteboard and `null` from the native half when it cannot be read at all, so the two are never confused.
 */

import { definePlugin, notImplemented, type NotImplemented, type PluginDefinition } from "./define";

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

export interface ClipboardWriteResult {
	readonly ok: true;
	readonly written: true;
}

/**
 * The native half of `crust:clipboard`. `readText` answers `""` for an empty
 * pasteboard and `null` when there is no pasteboard to read; `writeText` answers
 * the pasteboard's own verdict rather than the adapter's optimism.
 */
export interface ClipboardAdapter {
	readText(): string | null;
	writeText(text: string): ClipboardWriteVerdict;
}

export interface ClipboardWriteArgs {
	text: string;
}

/** `clipboard.read` takes no arguments; the shape exists so a client can type it. */
export type ClipboardReadArgs = Record<string, never>;

/** The selector the skipped image commands are waiting on, named once. */
const IMAGE_READ_SELECTOR = "NSPasteboard -readObjectsForClasses:options:";

export function createClipboardPlugin(adapter?: ClipboardAdapter): PluginDefinition<
	"clipboard",
	{
		read: (args?: ClipboardReadArgs) => ClipboardReadResult | ClipboardFailure | NotImplemented;
		write: (
			args?: ClipboardWriteArgs,
		) => ClipboardWriteResult | ClipboardFailure | NotImplemented;
		readImage: () => NotImplemented;
		writeImage: () => NotImplemented;
	}
> {
	const missing = (command: string) =>
		notImplemented(
			`clipboard.${command} needs the general pasteboard: NSPasteboard's -generalPasteboard, -stringForType: and -setString:forType: are AppKit, and this platform has no adapter for them. Pass a ClipboardAdapter to createClipboardPlugin when one is reachable.`,
			"NSPasteboard",
		);

	const failed = (error: unknown): ClipboardFailure => ({
		ok: false,
		code: "handler-error",
		message: error instanceof Error ? error.message : String(error),
	});

	return definePlugin({
		name: "clipboard",
		commands: {
			read: (): ClipboardReadResult | ClipboardFailure | NotImplemented => {
				if (!adapter) return missing("read");
				if (typeof adapter.readText !== "function") {
					return {
						ok: false,
						code: "unknown-adapter",
						message: "crust: clipboard adapter does not implement readText",
					};
				}
				let text: string | null;
				try {
					text = adapter.readText();
				} catch (error) {
					return failed(error);
				}
				// null is "no pasteboard to read", which is a different answer from
				// the empty string an empty clipboard gives.
				if (text === null) return missing("read");
				return { ok: true, text: typeof text === "string" ? text : String(text) };
			},

			write: (
				args?: ClipboardWriteArgs,
			): ClipboardWriteResult | ClipboardFailure | NotImplemented => {
				if (!adapter) return missing("write");
				if (typeof adapter.writeText !== "function") {
					return {
						ok: false,
						code: "unknown-adapter",
						message: "crust: clipboard adapter does not implement writeText",
					};
				}
				const text: unknown = args?.text;
				// The empty string is a legitimate write, so only a non-string is
				// refused; refusing "" would make "clear the clipboard" impossible.
				if (typeof text !== "string") {
					return {
						ok: false,
						code: "bad-request",
						message: 'clipboard.write: "text" must be a string',
					};
				}
				let verdict: ClipboardWriteVerdict;
				try {
					verdict = adapter.writeText(text);
				} catch (error) {
					return failed(error);
				}
				if (verdict === "written") return { ok: true, written: true };
				if (verdict === "missing") return missing("write");
				return {
					ok: false,
					code: "write-failed",
					message: `clipboard.write: the general pasteboard did not take the string (${String(verdict)})`,
				};
			},

			/**
			 * Skipped rather than faked: an image is a second object graph in C
			 * (`NSImage` in, PNG or TIFF bytes out), so this names the selector it
			 * is waiting on instead of answering an empty result.
			 */
			readImage: (): NotImplemented =>
				notImplemented(
					"clipboard.readImage needs image bytes off the pasteboard: -readObjectsForClasses:options: with NSImage, then a PNG or TIFF representation read back as bytes. Text is the only type this plugin moves today.",
					IMAGE_READ_SELECTOR,
				),

			writeImage: (): NotImplemented =>
				notImplemented(
					"clipboard.writeImage needs an NSImage built from the caller's bytes and written with -writeObjects:, which is a second object graph in C. Text is the only type this plugin moves today.",
					"NSPasteboard -writeObjects:",
				),
		},
	});
}

/** The default registration: honest about the missing framework. */
export const clipboardPlugin = createClipboardPlugin();
