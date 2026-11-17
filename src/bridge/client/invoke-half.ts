/**
 * The shapes the invoke half uses, in their own file so `invoke.ts` stays under the line cap.
 *
 * Type-only: erased at compile time, so `installInvoke.toString()` never sees them and the page copy
 * stays self-contained.
 */

/** The call plus the two things only a transport can do: ask for an event, and open the stream. */
export interface InvokeHalf {
	(plugin: string, command: string, args?: unknown): Promise<unknown>;
	/** One name is asked for once; the transport dedupes. */
	attach(event: string): void;
	/** Open the stream, once the app's first listeners are known. */
	connect(): void;
}

/** The two DOM reads the page half makes; a page stub in a test answers both. */
export interface DocumentLike {
	addEventListener?: (name: string, fn: (event: any) => void) => void;
	dispatchEvent?: (event: any) => void;
}
