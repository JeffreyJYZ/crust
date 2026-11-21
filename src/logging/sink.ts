/**
 * The file half: one writer queue, one live file, one error file, rotation at a size.
 *
 * Every append goes through a single promise chain, so two invokes finishing at once cannot
 * interleave inside one rotation. `write` never rejects — a full disk or an unwritable directory is
 * an outcome the caller reports, not an exception a request handler would turn into a 500.
 *
 * `tail` reads the live file, after the queue drains, so a record that `write` reported as stored is
 * visible to the next `tail`. That is the fix for hunt-50 finding 13/2: the old ring kept a line the
 * sink had refused, so `tail` showed lines that existed on no disk.
 */

import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";

import { redactText } from "./redact.ts";
import { parseLine, serializeRecord, sinceMs } from "./record.ts";
import { rotateChain } from "./rotate.ts";
import {
	DEFAULT_GENERATIONS,
	DEFAULT_MAX_BYTES,
	ERRORS_GENERATIONS,
	isLogLevel,
	isLogSource,
	type LogRecord,
	type ParsedLine,
	RING_SIZE,
	SEVERITY,
	type TailQuery,
	type TailResult,
} from "./types.ts";

export interface SinkOptions {
	/** The live `app.jsonl`. */
	file: string;
	/** The warn-and-above `errors.jsonl`, its sibling by default. */
	errorsFile: string;
	maxBytes?: number;
	generations?: number;
}

export interface SinkOutcome {
	written: boolean;
	/** Present only when the record reached the live file. */
	path?: string;
	/** The archive this write moved the live file to, if it rotated. */
	rotated?: string;
	error?: string;
}

export interface Sink {
	write(record: LogRecord): Promise<SinkOutcome>;
	tail(query?: TailQuery): Promise<TailResult>;
	/** Await everything already queued; a test uses it before reading the files itself. */
	flush(): Promise<void>;
	paths(): { file: string; errors: string };
}

async function sizeOf(file: string): Promise<number> {
	try {
		return (await stat(file)).size;
	} catch {
		return 0;
	}
}

export function createSink(options: SinkOptions): Sink {
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const generations = options.generations ?? DEFAULT_GENERATIONS;
	let queue: Promise<unknown> = Promise.resolve();

	function enqueue<Result>(task: () => Promise<Result>): Promise<Result> {
		const run = queue.then(task, task);
		queue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	/** One file, rotated first when it is full, then appended. */
	async function append(file: string, line: string, keep: number): Promise<string | undefined> {
		await mkdir(dirname(file), { recursive: true });
		const rotated =
			(await sizeOf(file)) >= maxBytes ? await rotateChain(file, keep) : undefined;
		await appendFile(file, `${line}\n`, "utf8");
		return rotated;
	}

	return {
		write(record: LogRecord): Promise<SinkOutcome> {
			return enqueue(async () => {
				const line = serializeRecord(record);
				let rotated: string | undefined;
				try {
					rotated = await append(options.file, line, generations);
				} catch (error) {
					return {
						written: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
				// `errors.jsonl` is the framework's triage subset. Page warnings are already in the
				// app's own stream and a page can emit them without a grant, so mirroring them lets a
				// page rotate away the real warnings; keep framework/plugin warnings only. A failure
				// to mirror must never take the app's log down with it.
				if (SEVERITY[record.level] <= SEVERITY.warn && record.source !== "page") {
					await append(options.errorsFile, line, ERRORS_GENERATIONS).catch(
						() => undefined,
					);
				}
				return {
					written: true,
					path: options.file,
					...(rotated === undefined ? {} : { rotated }),
				};
			});
		},

		async tail(query: TailQuery = {}): Promise<TailResult> {
			await queue.catch(() => undefined);
			let text: string;
			try {
				text = await readFile(options.file, "utf8");
			} catch {
				return { records: [] };
			}
			const floor = sinceMs(query.since);
			const wanted = isLogLevel(query.level) ? query.level : undefined;
			const source = isLogSource(query.source) ? query.source : undefined;
			const asked = Number.isInteger(query.limit) ? (query.limit as number) : RING_SIZE;
			const keep = Math.max(0, Math.min(RING_SIZE, asked));
			const records: ParsedLine[] = [];
			for (const line of text.split("\n")) {
				const parsed = parseLine(line);
				if (parsed === undefined) continue;
				if ("raw" in parsed) {
					// A corrupt line carries no fields to filter on; it is returned only to an unfiltered read.
					// It is still a line from the log file, so it gets the same text redaction a parsed
					// record's fields get — a truncated `?token=` must not come back verbatim.
					if (floor === undefined && wanted === undefined && source === undefined)
						records.push({ raw: redactText(String(parsed.raw)) });
					continue;
				}
				if (wanted !== undefined && SEVERITY[parsed.level] > SEVERITY[wanted]) continue;
				if (source !== undefined && parsed.source !== source) continue;
				if (floor !== undefined) {
					const at = Date.parse(parsed.ts);
					if (!Number.isFinite(at) || at < floor) continue;
				}
				records.push(parsed);
			}
			return { records: records.slice(Math.max(0, records.length - keep)) };
		},

		async flush(): Promise<void> {
			await queue.catch(() => undefined);
		},

		paths() {
			return { file: options.file, errors: options.errorsFile };
		},
	};
}
