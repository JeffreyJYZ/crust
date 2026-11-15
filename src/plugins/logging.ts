/**
 * `crust:logging` — the sink half of Tauri's log plugin: a level filter, an append-only file under the app's
 * data directory, and an in-memory ring so a page reads the tail without touching the disk. A line below the
 * configured level is dropped before it reaches the file, and `write` reports which of the two happened.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { definePlugin } from "./define";

export type LogLevel = "error" | "warn" | "info" | "debug";

/** Higher is chattier, so "below the configured level" is one numeric comparison. */
const SEVERITY: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

/** Lines kept in memory for `tail`; the file itself is unbounded. */
export const RING_SIZE = 200;

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

export interface WriteResult {
	written: boolean;
	/** The line as stored, present whenever it was formatted at all. */
	line?: string;
	/** Why nothing reached the file: `below-level`, `bad-level`, `sink-error`. */
	reason?: string;
	/** Absolute log path, present when written. */
	path?: string;
	error?: string;
}

export interface TailArgs {
	/** Defaults to the whole ring, capped at {@link RING_SIZE}. */
	limit?: number;
}

export interface TailResult {
	lines: string[];
}

export function isLogLevel(value: unknown): value is LogLevel {
	return typeof value === "string" && Object.hasOwn(SEVERITY, value);
}

function reasonOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function createLoggingPlugin(adapter: LoggingAdapter = {}) {
	const root =
		adapter.root ??
		join(adapter.home ?? homedir(), "Library", "Application Support", adapter.appId ?? "crust");
	const file = join(root, "logs", "app.log");
	const now = adapter.now ?? (() => Date.now());
	let current: LogLevel = isLogLevel(adapter.level) ? adapter.level : "info";
	const ring: string[] = [];

	return definePlugin({
		name: "logging",
		commands: {
			setLevel: ({ level }: SetLevelArgs): SetLevelResult => {
				if (!isLogLevel(level)) return { level: current, changed: false };
				const changed = level !== current;
				current = level;
				return { level: current, changed };
			},
			level: (): LogLevel => current,
			write: async ({ level, message }: WriteArgs): Promise<WriteResult> => {
				if (!isLogLevel(level)) return { written: false, reason: "bad-level" };
				if (SEVERITY[level] > SEVERITY[current]) {
					return { written: false, reason: "below-level" };
				}
				const line = `${new Date(now()).toISOString()} ${level.toUpperCase()} ${String(message)}`;
				ring.push(line);
				if (ring.length > RING_SIZE) ring.shift();
				try {
					await mkdir(dirname(file), { recursive: true });
					await appendFile(file, `${line}\n`, "utf8");
				} catch (error) {
					return { written: false, reason: "sink-error", line, error: reasonOf(error) };
				}
				return { written: true, line, path: file };
			},
			tail: ({ limit }: TailArgs = {}): TailResult => {
				const asked = Number.isInteger(limit) ? (limit as number) : RING_SIZE;
				const keep = Math.max(0, Math.min(RING_SIZE, asked));
				return { lines: ring.slice(ring.length - keep) };
			},
		},
	});
}

/** The default registration: `~/Library/Application Support/crust/logs/app.log` until an app names itself. */
export const loggingPlugin = createLoggingPlugin();
