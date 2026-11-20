/**
 * `crust:logging`'s vocabulary: the five levels, the six sources, one JSONL record, and the query
 * `tail` answers. Kept apart from the sink so the plugin and every wiring point can import the
 * shape without pulling in the writer or `node:fs`.
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

/** Every level, quietest first. `LEVELS` order is the severity order `SEVERITY` encodes. */
export const LEVELS: readonly LogLevel[] = ["error", "warn", "info", "debug", "trace"];

/** Higher is chattier, so "below the configured level" is one numeric comparison. */
export const SEVERITY: Record<LogLevel, number> = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
	trace: 4,
};

export function isLogLevel(value: unknown): value is LogLevel {
	return typeof value === "string" && Object.hasOwn(SEVERITY, value);
}

/** Who wrote the line. The set is closed: a typo in a source is a compile error, not a stray value. */
export type LogSource = "app" | "window" | "bridge" | "page" | "platform" | "plugin";

export const SOURCES: readonly LogSource[] = [
	"app",
	"window",
	"bridge",
	"page",
	"platform",
	"plugin",
];

export function isLogSource(value: unknown): value is LogSource {
	return typeof value === "string" && (SOURCES as readonly string[]).includes(value);
}

/**
 * One line of `app.jsonl`. The six named fields are always present; every other key is a
 * source-specific field and has been through the redaction pass by the time it is serialised.
 */
export interface LogRecord {
	/** ISO 8601 with milliseconds. */
	ts: string;
	level: LogLevel;
	source: LogSource;
	/** Stable dotted name, e.g. `bridge.invoke`. */
	event: string;
	/** One human sentence. */
	msg: string;
	/** Process id, so a dev restart's lines are separable. */
	pid: number;
	/** Monotonic per process, so ordering survives equal timestamps. */
	seq: number;
	[field: string]: unknown;
}

/** A line `tail` could not parse is handed back with its bytes intact rather than dropped. */
export type ParsedLine = LogRecord | { raw: string };

/** What one wiring point hands the logger. */
export interface LogInput {
	level: LogLevel;
	source: LogSource;
	event: string;
	msg: string;
	fields?: Record<string, unknown>;
}

export interface TailQuery {
	/** Defaults to {@link RING_SIZE}; the newest records win. */
	limit?: number;
	/** Keep records at or above this severity. */
	level?: LogLevel;
	source?: LogSource;
	/** ISO timestamp or epoch milliseconds; older records are dropped. */
	since?: string | number;
}

export interface TailResult {
	records: ParsedLine[];
}

/** Live file rotates at this size; also the default `logging.maxBytes`. */
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/** Generations of `app.jsonl` kept. `errors.jsonl` keeps {@link ERRORS_GENERATIONS}. */
export const DEFAULT_GENERATIONS = 3;
export const ERRORS_GENERATIONS = 1;

/** Directory under the app's data root. */
export const DEFAULT_LOG_DIR = "logs";

export const APP_FILE = "app.jsonl";
export const ERRORS_FILE = "errors.jsonl";

/** Default number of records `tail` answers, and the cap on a single answer. */
export const RING_SIZE = 200;
