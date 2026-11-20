/**
 * `crust:logging` — the page-facing half of the framework's structured log.
 *
 * One JSON object per line in `<app data>/logs/app.jsonl`, rotated across generations, plus
 * `logs/errors.jsonl` for warn and above. The framework writes its own story through the same sink
 * (`src/logging/logger.ts`): app lifecycle, window events, every bridge invoke, page console and
 * uncaught errors, and platform refusals. Backend and `main.ts` code log with the SDK's `log`
 * (`src/logging/app.ts`); **a page uses `write`/`tail` here**, behind a capability grant, because a
 * page cannot reach a module in this process.
 *
 * Format and fields live in `src/logging/types.ts` and `records.ts`; the writer, the queue and the
 * rotation are `sink.ts`/`rotate.ts`. This file is the command surface only.
 */

import {
	configureLogger,
	logDirs,
	loggerLevel,
	loggerPaths,
	type LogLevel,
	type LogSource,
	repointLogFile,
	setLoggerLevel,
	tailRecords,
	writeRecord,
} from "@/logging";
import { definePlugin } from "./define";
import { type ConfigureArgs, type ConfigureResult, resolveLogFile } from "./logging-configure";

export type { LogLevel } from "@/logging";
export { isLogLevel, RING_SIZE } from "@/logging";
export { logDirs } from "@/logging";

export interface LoggingAdapter {
	/** Data directory the `logs/` sink sits under; a test injects a temp one. */
	root?: string;
	/** Bundle id that names the default root, `~/Library/Application Support/<id>`. */
	appId?: string;
	home?: string;
	/** Clock, so a test can pin the timestamp. */
	now?: () => number;
	/** Level the plugin starts at. */
	level?: LogLevel;
	/** `logging.dir` from the config, relative to the app data root. */
	dir?: string;
	/** `logging.console`: mirror warn and above to stderr. */
	console?: boolean;
	/** `logging.generations` and `logging.maxBytes`. */
	generations?: number;
	maxBytes?: number;
	/** `crust dev`: every written record streams to stderr. It does not raise the level. */
	dev?: boolean;
}

export interface SetLevelArgs {
	level: LogLevel;
}

export interface SetLevelResult {
	level: LogLevel;
	/** False when the argument was not a level, so the caller can tell "ignored" from "applied". */
	changed: boolean;
}

export interface WriteArgs {
	level: LogLevel;
	message: string;
}

export type { WriteResult } from "@/logging";

export interface TailArgs {
	/** Defaults to {@link RING_SIZE}; the newest records win. */
	limit?: number;
	/** Keep records at or above this severity. */
	level?: LogLevel;
	/** One of the six sources. */
	source?: LogSource;
	/** ISO timestamp or epoch milliseconds. */
	since?: string | number;
}

export type { TailResult } from "@/logging";

/**
 * Build the commands and point the process logger at `adapter`. One logger per process, because a
 * page's `tail` must read the framework's lines too; constructing a second plugin reconfigures it,
 * which is the same thing a process start does and what keeps a test's temp root isolated.
 */
export function createLoggingPlugin(adapter: LoggingAdapter = {}) {
	// An explicit adapter is a test or an app pointing the sink somewhere; the bare default plugin
	// only registers commands and leaves the process logger for `startApp`/`app.run()` to configure,
	// so importing the barrel never creates a data directory as a side effect.
	if (Object.keys(adapter).length > 0) configureLogger(adapter);
	// The containment boundary is the root the process is actually writing under: an adapter that
	// names one owns it, and otherwise `startApp`/`app.run()` configured it, so a page's
	// `logging.configure` cannot escape the app's own data directory by being checked against crust's
	// default root instead of this app's.
	const rootNow = (): string => adapter.root ?? loggerPaths().root;

	return definePlugin({
		name: "logging",
		commands: {
			setLevel: ({ level }: SetLevelArgs): SetLevelResult => {
				if (!isLevelArgument(level)) return { level: loggerLevel(), changed: false };
				const changed = setLoggerLevel(level);
				return { level, changed };
			},
			level: (): LogLevel => loggerLevel(),
			configure: ({ file: next, level }: ConfigureArgs = {}): ConfigureResult => {
				let target: string | undefined;
				if (next !== undefined) {
					try {
						target = resolveLogFile(rootNow(), next);
					} catch (error) {
						return {
							ok: false,
							error: error instanceof Error ? error.message : String(error),
						};
					}
				}
				if (level !== undefined) {
					if (!setLoggerLevel(level)) {
						return { ok: false, error: `logging.configure: "${level}" is not a level` };
					}
				}
				if (target !== undefined) repointLogFile(rootNow(), target);
				return { ok: true, file: loggerPaths().file, level: loggerLevel() };
			},
			write: async ({ level, message }: WriteArgs) =>
				await writeRecord({
					level,
					source: "plugin",
					event: "log.write",
					msg: String(message),
				}),
			tail: async (query: TailArgs = {}) => await tailRecords(query),
		},
	});
}

function isLevelArgument(level: unknown): level is LogLevel {
	return typeof level === "string" && ["trace", "debug", "info", "warn", "error"].includes(level);
}

/** The default registration: `~/Library/Application Support/crust/logs/app.jsonl`. */
export const loggingPlugin = createLoggingPlugin();
