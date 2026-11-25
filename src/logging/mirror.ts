/**
 * The human mirror: one record becomes one readable line, on the stream its severity belongs to.
 *
 * Split from `logger.ts` because the routing is a decision of its own and the file cap is real. The
 * stream follows severity — `debug` and `info` to stdout, `warn` through `console.warn`, `error` to
 * stderr — so a person redirecting `2>` gets what went wrong rather than the whole conversation, and
 * a terminal that tints stderr red cannot paint a healthy `info` line as a failure.
 */

import { oneLineMessage } from "./message.ts";
import { type LogLevel, type LogRecord, SEVERITY } from "./types.ts";

/** What the mirror needs to know: whether it is on at all, and whether this is `crust dev`. */
export interface MirrorOptions {
	mirror: boolean;
	dev: boolean;
}

/** The human line a person reads in a terminal or the app's own console. */
export function humanLine(record: LogRecord): string {
	const msg = oneLineMessage(record.msg);
	return `${record.ts} ${record.level.toUpperCase()} ${record.source} ${record.event} ${msg}`;
}

/** One record on the stream its level belongs to. */
export function mirrorTo(level: LogLevel, line: string): void {
	if (SEVERITY[level] <= SEVERITY.warn) {
		if (SEVERITY[level] === SEVERITY.warn) console.warn(line);
		else console.error(line);
		return;
	}
	console.log(line);
}

/** A record mirrored only when the sink is set to mirror, and only at or above what that mode shows. */
export function mirrorRecord(record: LogRecord, options: MirrorOptions): void {
	if (!options.mirror) return;
	if (!options.dev && SEVERITY[record.level] > SEVERITY.warn) return;
	mirrorTo(record.level, humanLine(record));
}
