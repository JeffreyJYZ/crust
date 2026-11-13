#!/usr/bin/env bun
import { build } from "./build.ts";
import { dev } from "./dev.ts";
import { dmg } from "./dmg.ts";
import { doctor } from "./doctor.ts";
import { init, type InitOptions } from "./init.ts";
import { sign } from "./sign.ts";
import { type CliOptions, VERSION } from "./util.ts";

const COMMANDS = ["init", "dev", "build", "sign", "dmg", "doctor"] as const;
type CommandName = (typeof COMMANDS)[number];

const USAGE = `crust — a Bun-native desktop app framework. No Rust. Just crust.

usage:
  crust init <dir> [--react]
                           scaffold an app in an empty directory (--react: React + Vite)
  crust dev [file] [options]
                           watch the backend, restart it on change, follow the
                           frontend URL; with a .tsx/.jsx/.ts/.js file, run that
                           one file as the app (no config needed)
  crust build [file] [options]
                           compile the binary and assemble X.app (ad-hoc
                           signed); with a file, build the single-file app
  crust sign [options]     Developer ID signing (needs a certificate)
  crust dmg [options]      build a drag-to-Applications disk image
  crust doctor [options]   report why the app did not open

options:
  --dir <path>       project directory (default: current directory)
  --config <path>    config file, relative to --dir
  --entry <path>     backend entry, relative to --dir (default: src/main.ts)
  --react            init only: copy the React + Vite template instead of the
                     vanilla one
  --help, -h         this text
  --version, -v      the crust version

The published limits: ~85 MiB per app (Bun ships its runtime), macOS arm64 only,
and no Developer ID signature yet, so Gatekeeper refuses builds on other machines.`;

interface Parsed {
	command?: CommandName | string;
	/** The single positional after the command: init's directory, or dev/build's file. */
	positional?: string;
	/** The shared CLI options, plus init's one template flag. */
	options: InitOptions;
	help: boolean;
	version: boolean;
	error?: string;
}

function parse(argv: string[]): Parsed {
	const options: InitOptions = { dir: process.cwd() };
	let command: string | undefined;
	let positional: string | undefined;
	let dirExplicit = false;
	let react = false;
	let help = false;
	let version = false;

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === undefined) continue;
		switch (arg) {
			case "--help":
			case "-h":
				help = true;
				break;
			case "--version":
			case "-v":
				version = true;
				break;
			case "--react":
				react = true;
				break;
			case "--dir":
			case "--config":
			case "--entry": {
				const value = argv[++index];
				if (value === undefined)
					return { options, help, version, error: `${arg} needs a value` };
				if (arg === "--dir") {
					options.dir = value;
					dirExplicit = true;
				}
				if (arg === "--config") options.config = value;
				if (arg === "--entry") options.entry = value;
				break;
			}
			default:
				if (arg.startsWith("-"))
					return { options, help, version, error: `unknown option ${arg}` };
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
				return { options, help, version, error: `unexpected argument ${arg}` };
		}
	}

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

	return { command, positional, options, help, version };
}

function isCommand(name: string): name is CommandName {
	return (COMMANDS as readonly string[]).includes(name);
}

async function main(argv: string[]): Promise<number> {
	const parsed = parse(argv);

	if (parsed.error) {
		console.error(`crust: ${parsed.error}`);
		console.error(`run "crust --help" for usage`);
		return 1;
	}
	if (parsed.version) {
		console.log(VERSION);
		return 0;
	}
	if (parsed.help || parsed.command === undefined) {
		console.log(USAGE);
		return parsed.help ? 0 : 1;
	}
	if (!isCommand(parsed.command)) {
		console.error(`crust: unknown command "${parsed.command}"`);
		console.error(`run "crust --help" for usage`);
		return 1;
	}

	const handlers: Record<CommandName, (options: CliOptions) => Promise<number>> = {
		init,
		dev,
		build,
		sign,
		dmg,
		doctor,
	};

	try {
		return await handlers[parsed.command](parsed.options);
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		console.error(`crust ${parsed.command}: ${text}`);
		return 1;
	}
}

process.exitCode = await main(process.argv.slice(2));
