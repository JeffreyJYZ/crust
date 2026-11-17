/**
 * argv to a command plus its options. Every rejection is an `error` string the
 * caller prints with the usage hint, so parsing never throws and never exits.
 */

import type { InitOptions } from "./init.ts";
import { parseFormats } from "./package/format.ts";

export interface Parsed {
	command?: string;
	/** The single positional after the command: init's directory, or dev/build's file. */
	positional?: string;
	options: InitOptions;
	help: boolean;
	version: boolean;
	error?: string;
}

export function parse(argv: string[]): Parsed {
	const options: InitOptions = { dir: process.cwd() };
	let command: string | undefined;
	let positional: string | undefined;
	let dirExplicit = false;
	let react = false;
	let next = false;
	// Global flags are decided before the loop: a flag-looking token after a
	// value-taking flag must never be eaten as that value, and help/version
	// answer the invocation even when an unrelated flag would fail validation.
	const help = argv.some((arg) => arg === "--help" || arg === "-h");
	const version = argv.some((arg) => arg === "--version" || arg === "-v");
	const globalFlag = help || version;
	const formatValues: string[] = [];
	let missingValue: string | undefined;

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === undefined) continue;
		switch (arg) {
			case "--help":
			case "-h":
			case "--version":
			case "-v":
				break;
			case "--react":
				react = true;
				break;
			case "--next":
				next = true;
				break;
			case "--dir":
			case "--config":
			case "--entry":
			case "--format": {
				const candidate = argv[index + 1];
				if (candidate === undefined || candidate.startsWith("-")) {
					// Leave a following flag for the loop; report the missing
					// value only when help/version are not answering this call.
					missingValue ??= `${arg} needs a value`;
					break;
				}
				index++;
				const value = candidate;
				if (arg === "--dir") {
					options.dir = value;
					dirExplicit = true;
				}
				if (arg === "--config") options.config = value;
				if (arg === "--entry") options.entry = value;
				if (arg === "--format") formatValues.push(value);
				break;
			}
			default:
				if (arg.startsWith("-")) {
					if (globalFlag) break;
					return { options, help, version, error: `unknown option ${arg}` };
				}
				if (command === undefined) {
					command = arg;
					break;
				}
				if (
					positional === undefined &&
					(command === "init" || command === "dev" || command === "build")
				) {
					positional = arg;
					break;
				}
				if (globalFlag) break;
				return { options, help, version, error: `unexpected argument ${arg}` };
		}
	}

	if (globalFlag) return { command, positional, options, help, version };
	if (missingValue !== undefined) return { options, help, version, error: missingValue };

	if (positional !== undefined) {
		if (command === "dev" || command === "build") {
			// `crust dev app.tsx`: the positional is the app, not a new project.
			options.single = positional;
		} else if (command === "init") {
			if (dirExplicit) {
				return {
					options,
					help,
					version,
					error: "init takes one directory — pass <dir> or --dir, not both",
				};
			}
			options.dir = positional;
		}
	}

	if (react) {
		if (command !== "init") {
			return { options, help, version, error: "--react only applies to init" };
		}
		options.react = true;
	}
	if (next) {
		if (command !== "init") {
			return { options, help, version, error: "--next only applies to init" };
		}
		options.next = true;
	}

	if (formatValues.length > 0) {
		if (command !== "package") {
			return { options, help, version, error: "--format only applies to package" };
		}
		const formats = parseFormats(formatValues);
		if (!formats.ok) return { options, help, version, error: formats.error };
		options.formats = formats.formats;
	}

	return { command, positional, options, help, version };
}
