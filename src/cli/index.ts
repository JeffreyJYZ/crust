#!/usr/bin/env bun
import { COMMANDS, isCommand } from "./commands.ts";
import { parse } from "./parse.ts";
import { USAGE } from "./usage.ts";
import { VERSION } from "./util.ts";

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
	if (parsed.help || parsed.command === undefined) {
		console.log(USAGE);
		return parsed.help ? 0 : 1;
	}
	if (!isCommand(parsed.command)) {
		console.error(`crust: unknown command "${parsed.command}"`);
		console.error(`run "crust --help" for usage`);
		return 1;
	}

	try {
		return await COMMANDS[parsed.command](parsed.options);
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		console.error(`crust ${parsed.command}: ${text}`);
		return 1;
	}
}

process.exitCode = await main(process.argv.slice(2));
