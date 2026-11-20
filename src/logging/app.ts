/**
 * The app's own logger, the backend half of `crust:logging`.
 *
 * ```ts
 * import { log } from "crust";
 * log.info("sync finished", { files: 12, ms: 340 });
 * const net = log.tag("net");        // every line gains `tag: "net"`
 * net.warn("retrying", { attempt: 2 });
 * ```
 *
 * It writes the same `logs/app.jsonl`, through the same level filter and the same redaction as the
 * framework's own events: an app line is `source: "app"`, `event: "app.log"`, plus a `tag` when one
 * is set, so its origin is visible and its fields are indistinguishable in format. No platform and
 * no window is needed — it works in `main.ts` before `app.run()` and inside any handler.
 *
 * Which one to use: **backend and `main.ts` code use this**; **page code uses `logging.write`**
 * (behind a capability grant) because a page cannot reach a module in this process.
 */

import { logEvent } from "./logger.ts";
import type { LogLevel } from "./types.ts";

export interface AppLogger {
	trace(message: string, fields?: Record<string, unknown>): void;
	debug(message: string, fields?: Record<string, unknown>): void;
	info(message: string, fields?: Record<string, unknown>): void;
	warn(message: string, fields?: Record<string, unknown>): void;
	error(message: string, fields?: Record<string, unknown>): void;
	/** A child logger whose lines carry `tag`; the parent is unchanged. */
	tag(name: string): AppLogger;
}

/** The one event name for an app line; `tag` is what separates two subsystems. */
export const APP_LOG_EVENT = "app.log";

function emit(
	level: LogLevel,
	tag: string | undefined,
	message: string,
	fields: Record<string, unknown> | undefined,
): void {
	logEvent({
		level,
		source: "app",
		event: APP_LOG_EVENT,
		msg: String(message),
		fields: tag === undefined ? fields : { tag, ...fields },
	});
}

function loggerWith(tag?: string): AppLogger {
	return {
		trace: (message, fields) => emit("trace", tag, message, fields),
		debug: (message, fields) => emit("debug", tag, message, fields),
		info: (message, fields) => emit("info", tag, message, fields),
		warn: (message, fields) => emit("warn", tag, message, fields),
		error: (message, fields) => emit("error", tag, message, fields),
		tag: (name) => loggerWith(name),
	};
}

/** A logger carrying `tag` on every line. */
export function createLog(tag?: string): AppLogger {
	return loggerWith(tag);
}

/** The process-wide untagged logger: `log.info("ready")`. */
export const log: AppLogger = createLog();
