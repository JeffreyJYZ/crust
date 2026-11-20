import { isLogLevel, type LogLevel } from "@/logging/types.ts";
import type { Validator } from "./validator.ts";

export const LOGGING_KEYS = ["level", "console", "dir", "generations", "maxBytes"] as const;

export const LOG_LEVELS = "trace | debug | info | warn | error";

/**
 * A `dir` that is absolute would write outside the app's data directory, which is exactly the
 * boundary `logging.configure` already refuses for a page-chosen file; both belong at config time.
 */
export function validateLogging(v: Validator, value: unknown): void {
	if (value === undefined) return;
	const logging = v.object("logging", value);
	if (!logging) return;
	v.only(logging, "logging", LOGGING_KEYS);

	const level = v.string(logging, "level", "logging", false);
	if (level !== undefined && !isLogLevel(level)) v.fail("logging.level", LOG_LEVELS, level);

	const console = logging.console;
	if (console !== undefined && typeof console !== "boolean") {
		v.fail("logging.console", "a boolean", console);
	}

	const dir = v.string(logging, "dir", "logging", false);
	if (dir !== undefined && dir.startsWith("/")) {
		v.fail("logging.dir", "a path relative to the app data directory", dir);
	}

	v.positiveInteger(logging, "generations", "logging");
	v.positiveInteger(logging, "maxBytes", "logging");
}

export type { LogLevel };
