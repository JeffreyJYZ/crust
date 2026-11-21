/**
 * `crust:pty`'s downlink: one base64 frame per read, and the budget that keeps a chatty program
 * from turning a single read into an unbounded event flood.
 * Nothing here waits for `\n`. A pty delivers bytes, so an escape sequence split across two reads
 * must reach the page in order as two frames — re-assembling a line is what makes a terminal render
 * garbage, and it is why shell's line ring is the wrong tool for this stream.
 */

import type { PtyData } from "./pty-types";

/** The most bytes one `pty-data` frame carries; a larger read is sliced, never dropped. */
export const PTY_FRAME_BYTES = 8192;

/**
 * The most frames one read may enqueue. A flood beyond this is coalesced into the last frame rather
 * than dropped: bytes reach the page in order, but a chatty child cannot queue an unbounded number
 * of SSE frames per read. The platform read itself is bounded (64 KiB on the ConPTY shim).
 */
export const PTY_MAX_FRAMES_PER_READ = 8;

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
	maxFrames = PTY_MAX_FRAMES_PER_READ,
): (bytes: Uint8Array) => number {
	if (emit === undefined) return () => 0;
	return (bytes: Uint8Array): number => {
		const frames = Math.ceil(bytes.length / frameBytes);
		if (frames <= maxFrames) {
			for (let at = 0; at < bytes.length; at += frameBytes) {
				emitFrame(bytes.subarray(at, Math.min(at + frameBytes, bytes.length)));
			}
			return bytes.length;
		}
		// Emit whole frames up to the budget, then one final frame with the rest. The final frame is
		// larger than `frameBytes`, but the frame *count* stays bounded by `maxFrames` no matter how
		// large the read, which is the queue pressure this budget removes.
		const regular = (maxFrames - 1) * frameBytes;
		for (let at = 0; at < regular; at += frameBytes) {
			emitFrame(bytes.subarray(at, at + frameBytes));
		}
		emitFrame(bytes.subarray(regular));
		return bytes.length;
	};

	function emitFrame(slice: Uint8Array): void {
		// Base64 of the raw slice: the page decodes bytes, so a multi-byte character split across
		// two frames still joins correctly on the other side.
		emit?.("pty-data", {
			id,
			chunk: Buffer.from(slice).toString("base64"),
		} satisfies PtyData);
	}
}
