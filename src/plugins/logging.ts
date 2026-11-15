/**
 * `crust:logging` — the sink half of Tauri's log plugin: a level filter, a file under the app's data directory that rotates at
 * 1 MiB, and an in-memory ring so a page reads the tail without touching the disk. A line below the
 * configured level is dropped before it reaches the file, and `write` reports which of the two happened.
 */

import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { definePlugin } from "./define";

export type LogLevel = "trace" | "error" | "warn" | "info" | "debug";

/** Higher is chattier, so "below the configured level" is one numeric comparison. */
const SEVERITY: Record<LogLevel, number> = { trace: 0, error: 1, warn: 2, info: 3, debug: 4 };

/** Lines kept in memory for `tail`; the file itself is bounded by rotation instead. */
export const RING_SIZE = 200;

/** Size at which `app.log` moves aside before the next line is appended: 1 MiB. */
export const ROTATE_BYTES = 1024 * 1024;

/** The archive's file name; one generation, so the sink costs at most two files of disk. */
export const ROTATED_NAME = "app.log.1";

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
	/** Set when this write rotated the live file, naming the archive it moved to. */
	rotated?: string;
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

export interface LogDirs {
	/** The home directory the default root hangs under. */
	home: string;
	/** The per-app data root. */
	root: string;
	/** The directory holding the log files. */
	logs: string;
	/** The live log file. */
	file: string;
}

/**
 * The one place the sink's directories are computed. `crust:os`'s `paths` reads the same function,
 * so `appLog` cannot drift from where this plugin actually writes.
 */
export function logDirs(adapter: LoggingAdapter = {}): LogDirs {
	const home = adapter.home ?? homedir();
	const root =
		adapter.root ?? join(home, "Library", "Application Support", adapter.appId ?? "crust");
	const logs = join(root, "logs");
	return { home, root, logs, file: join(logs, "app.log") };
}

export function createLoggingPlugin(adapter: LoggingAdapter = {}) {
	const dirs = logDirs(adapter);
	const file = dirs.file;
	const archive = join(dirs.logs, ROTATED_NAME);
	const now = adapter.now ?? (() => Date.now());
	let current: LogLevel = isLogLevel(adapter.level) ? adapter.level : "info";
	const ring: string[] = [];

	/**
	 * Past the threshold the live file becomes `.1` before this write appends, so a line is never
	 * split across the rotation. POSIX `rename` replaces an older archive in one step.
	 */
	async function rotateIfLarge(): Promise<string | undefined> {
		let size = 0;
		try {
			size = (await stat(file)).size;
		} catch {
			return undefined;
		}
		if (size < ROTATE_BYTES) return undefined;
		await rename(file, archive);
		return archive;
	}

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
					const rotated = await rotateIfLarge();
					await appendFile(file, `${line}\n`, "utf8");
					const result: WriteResult = { written: true, line, path: file };
					if (rotated !== undefined) result.rotated = rotated;
					return result;
				} catch (error) {
					return { written: false, reason: "sink-error", line, error: reasonOf(error) };
				}
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
