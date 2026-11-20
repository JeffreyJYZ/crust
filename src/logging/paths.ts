/**
 * Where the log files live. One function, because three callers must agree: the plugin's sink, the
 * plugin's `configure` boundary, and `crust:os`'s `paths.appLog`. A second computation is how
 * `appLog` drifts from where the sink actually writes.
 */

import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { APP_FILE, DEFAULT_LOG_DIR, ERRORS_FILE } from "./types.ts";

export interface LogDirs {
	/** The home directory the default root hangs under. */
	home: string;
	/** The per-app data root. */
	root: string;
	/** The directory holding the log files. */
	logs: string;
	/** The live `app.jsonl`. */
	file: string;
	/** The warn-and-above `errors.jsonl`. */
	errors: string;
}

export interface LogDirOptions {
	root?: string;
	appId?: string;
	home?: string;
	/** `logging.dir`, relative to the app data root. */
	dir?: string;
}

export function logDirs(options: LogDirOptions = {}): LogDirs {
	const home = options.home ?? homedir();
	const root =
		options.root ?? join(home, "Library", "Application Support", options.appId ?? "crust");
	const dir = options.dir ?? DEFAULT_LOG_DIR;
	const logs = isAbsolute(dir) ? dir : join(root, dir);
	return { home, root, logs, file: join(logs, APP_FILE), errors: join(logs, ERRORS_FILE) };
}
