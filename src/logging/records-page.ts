/**
 * The page-source builder, split from `records.ts` when that file crossed the line cap. It takes the
 * one `crust:log` payload the page world dispatches — console lines, uncaught errors and unhandled
 * rejections — and shapes `page.console` / `page.error`.
 */

import { oneLineMessage } from "./message.ts";
import type { LogInput, LogLevel } from "./types.ts";

/** A console method's own name mapped onto the five levels a record may carry. */
const CONSOLE_LEVEL: Record<string, LogLevel> = {
	log: "info",
	info: "info",
	debug: "debug",
	warn: "warn",
	error: "error",
	trace: "trace",
};

export interface PageLogPayload {
	kind: "console" | "error" | "rejection";
	level?: string;
	args?: unknown[];
	message?: string;
	stack?: string;
	url?: string;
	line?: number;
	col?: number;
}

/** `page.console` and `page.error`, from the one `crust:log` detail the page world dispatches. */
export function pageRecord(payload: PageLogPayload, window?: string): LogInput {
	if (payload.kind === "console") {
		const name = payload.level ?? "log";
		return {
			level: CONSOLE_LEVEL[name] ?? "info",
			source: "page",
			event: "page.console",
			msg: oneLineMessage((payload.args ?? []).map((arg) => String(arg)).join(" ")),
			fields: { consoleLevel: name, args: payload.args ?? [], url: payload.url, window },
		};
	}
	return {
		level: "error",
		source: "page",
		event: "page.error",
		msg: oneLineMessage(String(payload.message ?? "uncaught page error")),
		fields: {
			message: payload.message,
			stack: payload.stack?.split("\n").slice(0, 8).join("\n"),
			url: payload.url,
			line: payload.line,
			col: payload.col,
			window,
			kind: payload.kind,
		},
	};
}
