/**
 * `crust:pty`'s downlink: one base64 frame per read, and the budget that keeps a chatty program
 * from turning a single read into an unbounded event.
 * Nothing here waits for `\n`. A pty delivers bytes, so an escape sequence split across two reads
 * must reach the page in order as two frames — re-assembling a line is what makes a terminal render
 * garbage, and it is why shell's line ring is the wrong tool for this stream.
 */

import type { PtyData } from "./pty-types";

/** The most bytes one `pty-data` frame carries; a larger read is sliced, never dropped. */
export const PTY_FRAME_BYTES = 8192;

/** The page-facing sink `open` takes from its plugin context. */
export type Emit = (event: string, data: unknown) => void;

/**
 * Build the sink a reader hands every chunk to. It answers how many bytes reached the page, so a
 * caller can count what a frame cost without re-decoding it, and it answers 0 when no page is
 * listening — bytes are still counted by the caller, never buffered here.
 */
export function frameSink(
	emit: Emit | undefined,
	id: string,
	frameBytes = PTY_FRAME_BYTES,
): (bytes: Uint8Array) => number {
	if (emit === undefined) return () => 0;
	return (bytes: Uint8Array): number => {
		for (let at = 0; at < bytes.length; at += frameBytes) {
			const slice = bytes.subarray(at, Math.min(at + frameBytes, bytes.length));
			// Base64 of the raw slice: the page decodes bytes, so a multi-byte character split across
			// two frames still joins correctly on the other side.
			emit("pty-data", {
				id,
				chunk: Buffer.from(slice).toString("base64"),
			} satisfies PtyData);
		}
		return bytes.length;
	};
}
