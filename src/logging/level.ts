/**
 * The level vocabulary's precedence in one place: `crust dev --log-level`, then `CRUST_LOG`, then
 * `logging.level`, then the default `info`. `logger.ts` reads the last two when a process starts;
 * `crust dev` turns its own flag into `CRUST_LOG` for the runtime child, which is where the run's
 * log is configured, so the child needs no third mechanism.
 *
 * An unrecognised value in a lower source never silently wins: the sources are tried in order and
 * the first recognised one answers. The flag's own bad value is refused by the CLI before this runs.
 */

import { isLogLevel, type LogLevel } from "./types.ts";

/** What a refusal or a warning lists, in severity order, so one wording serves every source. */
export const LEVEL_NAMES = "trace, debug, info, warn or error";

export interface LevelSources {
	/** `crust dev --log-level`, already validated by argv. */
	flag?: unknown;
	/** `CRUST_LOG`, from a shell or forwarded from `crust dev`'s flag. */
	env?: unknown;
	/** `logging.level`, already validated by the config loader. */
	config?: unknown;
}

/** The first recognised source wins; `info` is the default for a built app and for `crust dev`. */
export function resolveLogLevel(sources: LevelSources, fallback: LogLevel = "info"): LogLevel {
	for (const value of [sources.flag, sources.env, sources.config]) {
		if (isLogLevel(value)) return value;
	}
	return fallback;
}

let warnedBadEnv = false;

/**
 * `CRUST_LOG` when it names a level. An unrecognised value is said once and skipped, so the config
 * or the default applies rather than the run silently sitting at a level nobody meant.
 */
export function envLogLevel(): unknown {
	const raw = process.env.CRUST_LOG;
	if (raw === undefined || isLogLevel(raw)) return raw;
	if (!warnedBadEnv) {
		warnedBadEnv = true;
		console.error(
			`crust: CRUST_LOG="${raw}" is not a level — expected ${LEVEL_NAMES}; ` +
				"logging.level or the default applies",
		);
	}
	return undefined;
}

/** The level a process starts at: `CRUST_LOG` beats `logging.level`, which beats `info`. */
export function configuredLogLevel(config: unknown): LogLevel {
	return resolveLogLevel({ env: envLogLevel(), config });
}
