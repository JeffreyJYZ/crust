/**
 * One builder per log source, so the fields the brief names are decided in one place and a test can
 * assert them without running a bridge or a window. Each returns a {@link LogInput}; the logger adds
 * `ts`, `pid` and `seq`, redacts and writes.
 *
 * The record's core `event` is the dotted name (`window.create`), which is what the brief lists as
 * `window.*` plus `create/close/focus/resize`; there is no second `event` field to contradict it.
 */

import type { LogInput, LogLevel, LogSource } from "./types.ts";

/** Answer a level from an outcome, so a failure is never quieter than the call it failed. */
function failureLevel(code: string | undefined): LogLevel {
	return code === "handler-error" || code === "not-implemented" ? "error" : "warn";
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

export interface InvokeFields {
	window?: string;
	/** The page-supplied routing hint when it differs from the authoritative label. */
	hint?: string;
	ns: string;
	cmd: string;
	durMs: number;
	ok: boolean;
	code?: string;
	bytesIn?: number;
	bytesOut?: number;
	detail?: string;
}

/** `bridge.invoke`: duration, outcome, code and the labels that attribute a failure to a window. */
export function invokeRecord(fields: InvokeFields): LogInput {
	const code = fields.ok ? undefined : (fields.code ?? "handler-error");
	const target = fields.window === undefined ? fields.ns : `${fields.window} ${fields.ns}`;
	const verdict = fields.ok ? "ok" : code;
	return {
		level: fields.ok ? "info" : failureLevel(code),
		source: "bridge",
		event: "bridge.invoke",
		msg: oneLine(
			`${target}.${fields.cmd} ${verdict} in ${fields.durMs.toFixed(2)} ms` +
				(fields.detail === undefined ? "" : `: ${fields.detail}`),
		),
		fields: {
			window: fields.window,
			hint: fields.hint,
			ns: fields.ns,
			cmd: fields.cmd,
			durMs: Number(fields.durMs.toFixed(3)),
			ok: fields.ok,
			code,
			bytesIn: fields.bytesIn,
			bytesOut: fields.bytesOut,
		},
	};
}

export type RefusalReason = "origin" | "token" | "capability";

/**
 * `bridge.refuse`. A capability refusal is a page asking for something it was not granted, so it is
 * a warning; a token or origin refusal is pre-auth noise any local process can generate, so it is
 * `debug` and a built app at `info` keeps it out of the file. The event names which happened either
 * way, so `crust dev`'s `debug` stream shows all three.
 */
export function refuseRecord(fields: {
	reason: RefusalReason;
	window?: string;
	ns?: string;
	cmd?: string;
	detail?: string;
}): LogInput {
	return {
		level: fields.reason === "capability" ? "warn" : "debug",
		source: "bridge",
		event: "bridge.refuse",
		msg: oneLine(
			`${fields.ns === undefined ? "bridge" : `${fields.ns}.${fields.cmd}`} refused: ${fields.reason}` +
				(fields.detail === undefined ? "" : ` (${fields.detail})`),
		),
		fields: {
			reason: fields.reason,
			window: fields.window,
			ns: fields.ns,
			cmd: fields.cmd,
			detail: fields.detail,
		},
	};
}

export type WindowEvent = "create" | "close" | "focus" | "resize";

/** `window.*`: the label and frame that made the event attributable. */
export function windowRecord(fields: {
	event: WindowEvent;
	label: string;
	width?: number;
	height?: number;
	visible?: boolean;
}): LogInput {
	const size =
		fields.width === undefined || fields.height === undefined
			? ""
			: ` ${fields.width}x${fields.height}`;
	return {
		level: "info",
		source: "window",
		event: `window.${fields.event}`,
		msg: oneLine(`window ${fields.label} ${fields.event}${size}`),
		fields: {
			label: fields.label,
			width: fields.width,
			height: fields.height,
			visible: fields.visible,
		},
	};
}

/** `app.*`: lifecycle and the config summary. Callers pass only counts, never secret values. */
export function appRecord(
	event: string,
	msg: string,
	fields?: Record<string, unknown>,
	level: LogLevel = "info",
): LogInput {
	return { level, source: "app", event, msg: oneLine(msg), fields };
}

/** `platform.*`: everything a `not-implemented` refusal already carries. */
export function platformRecord(fields: {
	api: string;
	code: string;
	detail: string;
	source?: LogSource;
}): LogInput {
	return {
		level: "error",
		source: fields.source ?? "platform",
		event: "platform.refuse",
		msg: oneLine(
			`${fields.api} refused: ${fields.code}${fields.detail === "" ? "" : `: ${fields.detail}`}`,
		),
		fields: { api: fields.api, code: fields.code, detail: fields.detail },
	};
}

export { pageRecord, type PageLogPayload } from "./records-page.ts";
