#!/usr/bin/env bun
import { COMMANDS, isCommand } from "./commands.ts";
import { parse } from "./parse.ts";
import { commandHelp, USAGE } from "./usage.ts";
import { VERSION } from "./util.ts";

/** The no-config error is thrown by config/load.ts, which this layer does not own. */
const NO_CONFIG_PREFIXES = ["no crust config", "crust config not found"];
const NO_CONFIG_HINT =
	"run `crust init` for a new project, or use single-file mode " +
	"(`crust dev <file>`, which needs no config).";

function unknownCommand(name: string): number {
	console.error(`crust: unknown command "${name}"`);
	console.error(`run "crust --help" for usage`);
	return 1;
}

/** argv to an exit code: parse, answer `--help`/`--version`, then run the one command named. */
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
	if (parsed.help) {
		if (parsed.command === undefined) {
			console.log(USAGE);
			return 0;
		}
		// A typo plus --help must not read as success; validate before answering.
		if (!isCommand(parsed.command)) return unknownCommand(parsed.command);
		console.log(commandHelp(parsed.command));
		return 0;
	}
	if (parsed.command === undefined) {
		console.log(USAGE);
		return 1;
	}
	if (!isCommand(parsed.command)) return unknownCommand(parsed.command);

	try {
		return await COMMANDS[parsed.command](parsed.options);
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		console.error(`crust ${parsed.command}: ${text}`);
		if (NO_CONFIG_PREFIXES.some((prefix) => text.startsWith(prefix))) {
			console.error(NO_CONFIG_HINT);
		}
		return 1;
	}
}

process.exitCode = await main(process.argv.slice(2));
