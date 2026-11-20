/**
 * One record in, one line out, and the same line read back. `JSON.stringify` is the serialiser
 * because it already escapes a newline in a message, which is what keeps one record on one line;
 * a line that fails to parse is handed back as `{ raw }` rather than dropped, so a half-written
 * tail is visible instead of missing.
 */

import { redactFields, redactText } from "./redact.ts";
import {
	type LogInput,
	type LogRecord,
	isLogLevel,
	isLogSource,
	type ParsedLine,
} from "./types.ts";

/** ISO 8601 with milliseconds, from an epoch reading. */
export function isoAt(ms: number): string {
	return new Date(ms).toISOString();
}

/** A record with its core fields last, so a source field can never overwrite `level` or `ts`. */
export function buildRecord(input: LogInput, ts: number, pid: number, seq: number): LogRecord {
	const fields = redactFields(input.fields);
	return {
		...fields,
		ts: isoAt(ts),
		level: input.level,
		source: input.source,
		event: input.event,
		msg: redactText(input.msg),
		pid,
		seq,
	};
}

export function serializeRecord(record: LogRecord): string {
	return JSON.stringify(record);
}

/** How much of an unparseable line is kept; enough to recognise it, not a whole payload. */
const RAW_LIMIT = 2000;

function isRecord(value: unknown): value is LogRecord {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.ts === "string" &&
		isLogLevel(record.level) &&
		isLogSource(record.source) &&
		typeof record.event === "string" &&
		typeof record.msg === "string" &&
		typeof record.pid === "number" &&
		typeof record.seq === "number"
	);
}

/** A parsed line, or `{ raw }` when it is not a record. An empty line is not a record either. */
export function parseLine(line: string): ParsedLine | undefined {
	const text = line.trim();
	if (text.length === 0) return undefined;
	try {
		const value: unknown = JSON.parse(text);
		if (isRecord(value)) return value;
	} catch {
		// Fall through to the raw form: the bytes are the evidence.
	}
	return { raw: text.length > RAW_LIMIT ? `${text.slice(0, RAW_LIMIT)}…` : text };
}

/** A `tail` `since`, as epoch milliseconds, or undefined when it is not a usable value. */
export function sinceMs(value: string | number | undefined): number | undefined {
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		if (Number.isFinite(parsed)) return parsed;
		const epoch = Number(value);
		if (value.trim().length > 0 && Number.isFinite(epoch)) return epoch;
	}
	return undefined;
}
