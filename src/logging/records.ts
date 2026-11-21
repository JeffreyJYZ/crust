/**
 * One builder per log source, so the fields the brief names are decided in one place and a test can
 * assert them without running a bridge or a window. Each returns a {@link LogInput}; the logger adds
 * `ts`, `pid` and `seq`, redacts and writes.
 *
 * The record's core `event` is the dotted name (`window.create`), which is what the brief lists as
 * `window.*` plus `create/close/focus/resize`; there is no second `event` field to contradict it.
 */

import {
	type LogInput,
	type LogLevel,
	MAX_FIELD_CHARS,
	MAX_MSG_CHARS,
	type LogSource,
} from "./types.ts";

/** Answer a level from an outcome, so a failure is never quieter than the call it failed. */
function failureLevel(code: string | undefined): LogLevel {
	return code === "handler-error" || code === "not-implemented" ? "error" : "warn";
}

function cap(text: string, limit: number): string {
	return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function oneLine(text: string): string {
	return cap(text.replace(/\s+/g, " ").trim(), MAX_MSG_CHARS);
}

/** A page-supplied field: bounded before it is serialised, so a hostile name cannot fill the disk. */
function field(value: string | undefined): string | undefined {
	return value === undefined ? undefined : cap(value, MAX_FIELD_CHARS);
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
		// One line per call is a firehose, so a success is `debug`; a failure keeps the severity it
		// earned and is never quieter than the call it failed.
		level: fields.ok ? "debug" : failureLevel(code),
		source: "bridge",
		event: "bridge.invoke",
		msg: oneLine(
			`${target}.${fields.cmd} ${verdict} in ${fields.durMs.toFixed(2)} ms` +
				(fields.detail === undefined ? "" : `: ${fields.detail}`),
		),
		fields: {
			window: field(fields.window),
			hint: field(fields.hint),
			ns: field(fields.ns),
			cmd: field(fields.cmd),
			durMs: Number(fields.durMs.toFixed(3)),
			ok: fields.ok,
			code: field(code),
			bytesIn: fields.bytesIn,
			bytesOut: fields.bytesOut,
		},
	};
}

export type RefusalReason = "origin" | "token" | "capability";

/**
 * `bridge.refuse`. Every refusal is a `warn`: a page asking for something it was not granted, or a
 * request that failed the token or origin check, is the first thing a person needs at the default
 * level — a refused invoke is why the page did nothing. A capability refusal carries the action in
 * `detail`, so the record already says what to grant.
 */
export function refuseRecord(fields: {
	reason: RefusalReason;
	window?: string;
	ns?: string;
	cmd?: string;
	detail?: string;
}): LogInput {
	return {
		level: "warn",
		source: "bridge",
		event: "bridge.refuse",
		msg: oneLine(
			`${fields.ns === undefined ? "bridge" : `${fields.ns}.${fields.cmd}`} refused: ${fields.reason}` +
				(fields.detail === undefined ? "" : ` (${fields.detail})`),
		),
		fields: {
			reason: fields.reason,
			window: field(fields.window),
			ns: field(fields.ns),
			cmd: field(fields.cmd),
			detail: field(fields.detail),
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
		fields: { api: field(fields.api), code: field(fields.code), detail: field(fields.detail) },
	};
}

export { type PageLogPayload, pageRecord } from "./records-page.ts";
