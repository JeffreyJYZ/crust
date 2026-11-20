/**
 * argv translation and the old error strings, kept out of `index.ts` so the
 * entry point stays under the 200-line cap. Parse and dispatch stay there;
 * this file owns only the flag vocabulary and the wording cac's defaults fight.
 */

import { LEVEL_NAMES } from "@/logging/level.ts";
import { isLogLevel } from "@/logging/types.ts";
import type { CommandName } from "./commands.ts";
import type { InitOptions } from "./init.ts";
import { parseFormats } from "./package/format.ts";

export type RawOptions = Record<string, unknown>;
export const VALUE_FLAGS = ["dir", "config", "entry", "format"] as const;
const SCAFFOLDS = ["react", "next", "svelte", "vue", "solid"] as const;
const STAGE_FLAGS = ["sign", "notarize", "dmg"] as const;
const KNOWN = new Set<string>([
	"--",
	...VALUE_FLAGS,
	...SCAFFOLDS,
	...STAGE_FLAGS,
	"logLevel",
	"help",
	"h",
	"version",
	"v",
]);
const POSITIONAL_COMMANDS = new Set<string>(["init", "dev", "build"]);

/** cac's parsed options into the CliOptions every handler already receives. */
export function translate(
	name: CommandName,
	positional: string | undefined,
	raw: RawOptions,
): InitOptions {
	const options: InitOptions = { dir: typeof raw.dir === "string" ? raw.dir : process.cwd() };
	if (typeof raw.config === "string") options.config = raw.config;
	if (typeof raw.entry === "string") options.entry = raw.entry;
	if (positional !== undefined) {
		if (name === "dev" || name === "build") options.single = positional;
		else if (name === "init") options.dir = positional;
	}
	for (const flag of SCAFFOLDS) if (raw[flag] === true) options[flag] = true;
	for (const flag of STAGE_FLAGS) if (raw[flag] === true) options[flag] = true;
	if (raw.format !== undefined) {
		const values = Array.isArray(raw.format) ? raw.format.map(String) : [String(raw.format)];
		const parsed = parseFormats(values);
		if (parsed.ok) options.formats = parsed.formats;
	}
	const logLevel = Array.isArray(raw.logLevel) ? raw.logLevel.at(-1) : raw.logLevel;
	if (isLogLevel(logLevel)) options.logLevel = logLevel;
	return options;
}

/** The old error strings, in the old order. Returns the message when argv is refused. */
export function validate(
	command: CommandName,
	positionals: string[],
	raw: RawOptions,
): string | undefined {
	for (const key of Object.keys(raw)) {
		if (!KNOWN.has(key)) return `unknown option ${key.length > 1 ? `--${key}` : `-${key}`}`;
	}
	// `--log-level` is dev's, and its bad value is refused by name rather than falling back to the
	// default: a run at `info` because of a typo is the confusion this flag exists to remove.
	if (raw.logLevel !== undefined) {
		if (command !== "dev") return "--log-level only applies to dev";
		const value = Array.isArray(raw.logLevel) ? raw.logLevel.at(-1) : raw.logLevel;
		if (value === true) return "--log-level needs a value";
		if (!isLogLevel(value)) {
			return `unknown log level "${String(value)}" — expected ${LEVEL_NAMES}`;
		}
	}
	const allowed = POSITIONAL_COMMANDS.has(command) ? 1 : 0;
	if (positionals.length > allowed) return `unexpected argument ${positionals[allowed]}`;
	for (const flag of VALUE_FLAGS) {
		const value = raw[flag];
		if (value === true || (Array.isArray(value) && value.some((item) => item === true))) {
			return `--${flag} needs a value`;
		}
	}
	if (command === "init" && positionals.length === 1 && typeof raw.dir === "string") {
		return "init takes one directory — pass <dir> or --dir, not both";
	}
	for (const flag of SCAFFOLDS) {
		if (raw[flag] === true && command !== "init") return `--${flag} only applies to init`;
	}
	for (const flag of STAGE_FLAGS) {
		if (raw[flag] === true && command !== "build") return `--${flag} only applies to build`;
	}
	if (raw.format !== undefined && command !== "package") {
		return "--format only applies to package";
	}
	if (raw.format !== undefined) {
		const values = Array.isArray(raw.format) ? raw.format.map(String) : [String(raw.format)];
		const parsed = parseFormats(values);
		if (!parsed.ok) return parsed.error;
	}
	return undefined;
}
