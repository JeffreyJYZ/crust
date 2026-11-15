/**
 * `crust:clipboard` — text on the general pasteboard, the two commands Tauri's clipboard-manager exposes as `readText`/`writeText`. The image half is `clipboard-image.ts`; both register under this one plugin name. The plugin owns no framework: macOS supplies `darwinClipboardAdapter()` and a platform without one keeps answering a typed `NotImplemented` naming `NSPasteboard`, never an empty string that reads as "the clipboard is empty".
 * **A write is only `ok: true` when the pasteboard said it took the string.** `-setString:forType:` answers BOOL, so the adapter reports `written`, `refused` or `missing` and the plugin passes that verdict on; a refusal is a `ClipboardFailure` value, never a throw across the bridge. A read answers `""` for an empty pasteboard and `null` from the native half when it cannot be read at all, so the two are never confused.
 */

import {
	type ClipboardAdapter,
	type ClipboardFailure,
	type ClipboardReadArgs,
	type ClipboardReadResult,
	type ClipboardWriteArgs,
	type ClipboardWriteResult,
	type ClipboardWriteVerdict,
	handlerFailure,
	missingCommand,
	unknownAdapter,
	writeOutcome,
} from "./clipboard-contract";
import { type ClipboardImageCommands, imageCommands } from "./clipboard-image";
import { definePlugin, type NotImplemented, type PluginDefinition } from "./define";

export * from "./clipboard-contract";

export function createClipboardPlugin(adapter?: ClipboardAdapter): PluginDefinition<
	"clipboard",
	{
		read: (args?: ClipboardReadArgs) => ClipboardReadResult | ClipboardFailure | NotImplemented;
		write: (
			args?: ClipboardWriteArgs,
		) => ClipboardWriteResult | ClipboardFailure | NotImplemented;
	} & ClipboardImageCommands
> {
	return definePlugin({
		name: "clipboard",
		commands: {
			read: (): ClipboardReadResult | ClipboardFailure | NotImplemented => {
				if (!adapter) return missingCommand("read");
				if (typeof adapter.readText !== "function") return unknownAdapter("readText");
				let text: string | null;
				try {
					text = adapter.readText();
				} catch (error) {
					return handlerFailure(error);
				}
				// null is "no pasteboard to read", which is a different answer from
				// the empty string an empty clipboard gives.
				if (text === null) return missingCommand("read");
				return { ok: true, text: typeof text === "string" ? text : String(text) };
			},

			write: (
				args?: ClipboardWriteArgs,
			): ClipboardWriteResult | ClipboardFailure | NotImplemented => {
				if (!adapter) return missingCommand("write");
				if (typeof adapter.writeText !== "function") return unknownAdapter("writeText");
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
					return handlerFailure(error);
				}
				return writeOutcome("write", "string", verdict);
			},

			...imageCommands(adapter),
		},
	});
}

/** The default registration: honest about the missing framework. */
export const clipboardPlugin = createClipboardPlugin();
