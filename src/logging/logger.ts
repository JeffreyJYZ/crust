/**
 * The process's one structured logger: level gate, redaction, the sink, and the human mirror.
 *
 * One instance per process, deliberately. `crust:logging`'s page commands and the framework's own
 * wiring must write the same file, and a page's `tail` must therefore read the framework's lines;
 * two instances would be two sinks that only look like one log. Tests reconfigure it, which is the
 * same thing a process start does.
 *
 * `logEvent` is fire-and-forget: a wiring point on the request path cannot await a disk write, and
 * a logging failure must never become the failure it was meant to describe.
 */

import { dirname, join } from "node:path";

import { mirrorRecord } from "./mirror.ts";
import { type LogDirOptions, type LogDirs, logDirs } from "./paths.ts";
import { buildRecord } from "./record.ts";
import { createSink, type Sink } from "./sink.ts";
import {
	DEFAULT_GENERATIONS,
	DEFAULT_MAX_BYTES,
	ERRORS_FILE,
	isLogLevel,
	type LogInput,
	type LogLevel,
	RING_SIZE,
	SEVERITY,
	type TailQuery,
	type TailResult,
} from "./types.ts";

export type { LogDirs } from "./paths.ts";
export { logDirs } from "./paths.ts";

export interface LoggerOptions extends LogDirOptions {
	level?: LogLevel;
	console?: boolean;
	generations?: number;
	maxBytes?: number;
	now?: () => number;
	pid?: number;
	/** `crust dev`: `debug` unless a level is set, and every written record streams to the console. */
	dev?: boolean;
}

export interface WriteResult {
	written: boolean;
	/** The line as stored. **Only present when it was stored** (hunt-50 finding 13/3). */
	line?: string;
	/** Why nothing reached the file: `below-level`, `bad-level`, `sink-error`. */
	reason?: string;
	/** Absolute log path, present when written. */
	path?: string;
	/** Set when this write rotated the live file, naming the archive it moved to. */
	rotated?: string;
	error?: string;
}

interface State {
	dirs: LogDirs;
	sink: Sink;
	level: LogLevel;
	mirror: boolean;
	/** In dev every written record is mirrored; the config's `console` mirrors warn and above. */
	dev: boolean;
	now: () => number;
	pid: number;
	/** Kept so a `configure` repoint keeps the same rotation policy. */
	maxBytes: number;
	generations: number;
}

let sequence = 0;
let current: State | undefined;

function makeState(options: LoggerOptions): State {
	const dirs = logDirs(options);
	const generations = options.generations ?? DEFAULT_GENERATIONS;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	return {
		dirs,
		sink: createSink({
			file: dirs.file,
			errorsFile: dirs.errors,
			generations,
			maxBytes,
		}),
		level: isLogLevel(options.level)
			? options.level
			: options.dev === true
				? "debug"
				: "info",
		mirror: options.console === true || options.dev === true,
		dev: options.dev === true,
		now: options.now ?? (() => Date.now()),
		pid: options.pid ?? process.pid,
		maxBytes,
		generations,
	};
}

function state(): State {
	current ??= makeState({});
	return current;
}

/** Point the one logger at a root, level and sink. A process start, and a plugin/test reconfiguring. */
export function configureLogger(options: LoggerOptions = {}): void {
	current = makeState(options);
}

export function loggerPaths(): LogDirs {
	return state().dirs;
}

/** Whether a log is configured. The runtime configures one at start; a bare test is untouched. */
export function isLoggerConfigured(): boolean {
	return current !== undefined;
}

export function loggerLevel(): LogLevel {
	return state().level;
}

export function setLoggerLevel(level: unknown): boolean {
	if (!isLogLevel(level)) return false;
	const changed = state().level !== level;
	state().level = level;
	return changed;
}

/** Repoint the live file inside the app data root; the error file follows it as a sibling. */
export function repointLogFile(root: string, file: string): string {
	const next = state();
	const logs = dirname(file);
	next.dirs = {
		...next.dirs,
		root,
		logs,
		file,
		errors: join(logs, ERRORS_FILE),
	};
	next.sink = createSink({
		file,
		errorsFile: next.dirs.errors,
		maxBytes: next.maxBytes,
		generations: next.generations,
	});
	return file;
}

/** One record, written and mirrored. The plugin's `write` command awaits this. */
export async function writeRecord(input: LogInput): Promise<WriteResult> {
	const active = state();
	if (!isLogLevel(input.level))
		return { written: false, reason: "bad-level" };
	if (SEVERITY[input.level] > SEVERITY[active.level])
		return { written: false, reason: "below-level" };
	const record = buildRecord(input, active.now(), active.pid, ++sequence);
	mirrorRecord(record, active);
	const outcome = await active.sink.write(record);
	if (!outcome.written) {
		// No `line` here: a record the sink refused was never stored, and saying otherwise is the
		// second half of hunt-50 finding 13/3.
		return { written: false, reason: "sink-error", error: outcome.error };
	}
	return {
		written: true,
		line: JSON.stringify(record),
		path: outcome.path,
		...(outcome.rotated === undefined ? {} : { rotated: outcome.rotated }),
	};
}

/** The wiring points' entry: gated, redacted, queued, never thrown into the caller. */
export function logEvent(input: LogInput): void {
	const active = current;
	// Nothing has configured a log yet, so there is nothing to write to; a test that never starts an
	// app must not create `~/Library/Application Support/crust/logs` as a side effect.
	if (active === undefined) return;
	if (!isLogLevel(input.level)) return;
	if (SEVERITY[input.level] > SEVERITY[active.level]) return;
	const record = buildRecord(input, active.now(), active.pid, ++sequence);
	mirrorRecord(record, active);
	void active.sink.write(record).catch(() => undefined);
}

export async function tailRecords(query: TailQuery = {}): Promise<TailResult> {
	return state().sink.tail({ limit: RING_SIZE, ...query });
}

/** Wait for every queued append. A test reads the files itself after this. */
export async function flushLogger(): Promise<void> {
	await state().sink.flush();
}

/** Drop the configured sink. For a test that must not inherit the previous case's root. */
export function resetLogger(): void {
	current = undefined;
}
