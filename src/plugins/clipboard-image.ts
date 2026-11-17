/**
 * The image half of `crust:clipboard`: `readImage`/`writeImage` over a `ClipboardAdapter`, split from the text commands because an image is a second byte shape with its own refusal rule. The command names and results are the plugin's, so a client sees one `clipboard` namespace.
 */

import {
	type ClipboardAdapter,
	type ClipboardFailure,
	type ClipboardImageReadResult,
	type ClipboardImageWriteResult,
	type ClipboardWriteImageArgs,
	type ClipboardWriteVerdict,
	handlerFailure,
	isPng,
	missingCommand,
	unknownAdapter,
	writeOutcome,
} from "./clipboard-contract";
import type { NotImplemented } from "./define";

/** The two commands this module wires, in the shape the plugin registers. */
export type ClipboardImageCommands = {
	readImage: () => ClipboardImageReadResult | ClipboardFailure | NotImplemented;
	writeImage: (
		args?: ClipboardWriteImageArgs | Uint8Array,
	) => ClipboardImageWriteResult | ClipboardFailure | NotImplemented;
};

export function imageCommands(adapter?: ClipboardAdapter): ClipboardImageCommands {
	return {
		readImage: (): ClipboardImageReadResult | ClipboardFailure | NotImplemented => {
			if (!adapter) return missingCommand("readImage");
			if (typeof adapter.readImage !== "function") return unknownAdapter("readImage");
			let png: Uint8Array | null;
			try {
				png = adapter.readImage();
			} catch (error) {
				return handlerFailure(error);
			}
			if (png === null) return missingCommand("readImage");
			// A non-byte answer would be encoded as garbage by the bridge, so it is
			// a typed failure rather than a coerced buffer. Checked before the length
			// test: "" and [] are zero-length too, and reading them as an empty
			// pasteboard would hide the adapter mistake.
			if (!(png instanceof Uint8Array)) {
				return {
					ok: false,
					code: "handler-error",
					message: "crust: clipboard adapter did not return image bytes",
				};
			}
			// Zero bytes is the empty pasteboard, the image twin of "".
			if (png.length === 0) return { ok: true, png: null };
			return { ok: true, png };
		},

		writeImage: (
			args?: ClipboardWriteImageArgs | Uint8Array,
		): ClipboardImageWriteResult | ClipboardFailure | NotImplemented => {
			if (!adapter) return missingCommand("writeImage");
			if (typeof adapter.writeImage !== "function") return unknownAdapter("writeImage");
			// The bridge's binary route hands the body over as the argument itself,
			// so bare bytes and `{ png }` are the same request.
			const png: unknown = args instanceof Uint8Array ? args : args?.png;
			if (!(png instanceof Uint8Array) || !isPng(png)) {
				return {
					ok: false,
					code: "bad-request",
					message: 'clipboard.writeImage: "png" must be PNG bytes',
				};
			}
			let verdict: ClipboardWriteVerdict;
			try {
				verdict = adapter.writeImage(png);
			} catch (error) {
				return handlerFailure(error);
			}
			return writeOutcome("writeImage", "image", verdict);
		},
	};
}
