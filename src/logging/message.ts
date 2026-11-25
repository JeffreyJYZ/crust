/**
 * Message bounds and the one-line rule, shared by every producer and the human mirror.
 *
 * `JSON.stringify` already keeps one record on one physical line in the JSONL file, but the human
 * mirror prints `msg` raw. A page-supplied newline can therefore forge an extra severity line in the
 * stream a person redirects to a file. Normalising at both ends makes the mirror safe even for a
 * record built elsewhere.
 */

import { MAX_MSG_CHARS } from "./types.ts";

/** Truncate with a visible marker: a silent cut reads as a complete message. */
export function capText(text: string, limit: number): string {
	return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** One bounded physical line, whatever whitespace the caller supplied. */
export function oneLineMessage(text: string): string {
	return capText(text.replace(/\s+/g, " ").trim(), MAX_MSG_CHARS);
}
