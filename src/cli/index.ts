#!/usr/bin/env bun
/**
 * argv to an exit code. cac owns parsing, option typing and the command list;
 * this layer owns the few behaviours cac's defaults fight. Measured in cac 7.1.0
 * (node_modules/cac/dist/index.js plus a probe), not taken from its README:
 *
 * - `parse(argv, { run: false })` still calls `outputHelp`/`outputVersion` when
 *   `.help()`/`.version()` were used, and clears `matchedCommand`. We register
 *   `-h,--help` and `-v,--version` as plain options instead, so parsing is
 *   silent and the match survives our inspection.
 * - `outputVersion()` prints `crust/<ver> <platform> bun-<v>`; docs and the
 *   Homebrew assertion expect the bare version, so we print VERSION ourselves.
 * - `runMatchedCommand()` runs its own unknown-option/unused-arg checks with
 *   different wording (`Unknown option \`--wat\``) and cac's help exits 0 for
 *   `nope --help`. We call `parse` with run:false, validate against the old
 *   wording, then invoke the registered `.action()` ourselves.
 * - mri leaves a value-taking flag as boolean `true` when the next token is a
 *   flag, so `--dir --react` parses as dir:true, react:true; that is the
 *   missing-value signal, and a following flag is never eaten as a value.
 */
import { cac } from "cac";
import { translate, validate, VALUE_FLAGS, type RawOptions } from "./argv.ts";
import { COMMANDS, isCommand, type CommandName } from "./commands.ts";
import {
	BASIC_EXAMPLES,
	COMMAND_DESCRIPTIONS,
	NOTARIZE_CREDENTIALS,
	OPTION_DESCRIPTIONS,
	PUBLISHED_LIMITS,
} from "./help.ts";
import { VERSION } from "./util.ts";

/** The no-config error is thrown by config/load.ts, which this layer does not own. */
const NO_CONFIG_PREFIXES = ["no crust config", "crust config not found"];
const NO_CONFIG_HINT =
	"run `crust init` for a new project, or use single-file mode " +
	"(`crust dev <file>`, which needs no config).";
const HINT = 'run "crust --help" for usage';

/** The one cac instance. Exported so commands.test.ts reads the real command list. */
export const cli = cac("crust");
cli.usage("<command> [options]");
cli.option("-h, --help", "Display this message");
cli.option("-v, --version", "Display the crust version");
for (const [name, description] of Object.entries(OPTION_DESCRIPTIONS)) {
	// Scaffolds are boolean flags; only the four value flags take a <value>.
	const takesValue = VALUE_FLAGS.some((flag) => flag === name);
	cli.option(takesValue ? `--${name} <value>` : `--${name}`, description);
}
// The tagline leads the first example (cac prints only the bare command name
// above it), followed by three real invocations, then the two prose blocks.
// Their leading newlines survive cac's "\n" example join as blank separators.
cli.example(BASIC_EXAMPLES);
cli.example(NOTARIZE_CREDENTIALS);
cli.example(PUBLISHED_LIMITS);
for (const name of Object.keys(COMMANDS) as CommandName[]) {
	const command = cli.command(name, COMMAND_DESCRIPTIONS[name]);
	// cac's command usage line and Examples section render these; the header
	// and description used to be sliced out of USAGE by commandHelp().
	if (name === "init") command.usage("init <dir>");
	if (name === "dev") command.usage("dev [file]");
	if (name === "build") command.usage("build [file]");
	command.example(`crust ${name} — command help\n  ${COMMAND_DESCRIPTIONS[name]}`);
	// Options are registered once, globally; cac includes them in every
	// command's help, so command-level copies would only print them twice.
	// The real dispatch. `main` invokes this action after validation; cac's own
	// `runMatchedCommand` is deliberately never called (its error wording differs).
	command.action(async (raw: RawOptions, positional?: string) => {
		return await COMMANDS[name](translate(name, positional, raw));
	});
}

function unknownCommand(name: string): number {
	console.error(`crust: unknown command "${name}"`);
	console.error(HINT);
	return 1;
}

/** argv to an exit code: parse, answer `--help`/`--version`, then run one command. */
async function main(argv: string[]): Promise<number> {
	// Decided from raw argv: a global flag answers even when a value flag would
	// otherwise complain, and a following flag is never eaten as a value.
	const help = argv.some((arg) => arg === "--help" || arg === "-h");
	const version = argv.some((arg) => arg === "--version" || arg === "-v");
	const parsed = cli.parse(["bun", "crust", ...argv], { run: false });
	const raw = parsed.options as RawOptions;
	const command = cli.matchedCommandName ?? parsed.args[0];

	if (version) {
		console.log(VERSION);
		return 0;
	}
	if (help) {
		// A typo plus --help must not read as success; validate before answering.
		if (command !== undefined && !isCommand(command)) return unknownCommand(command);
		// cac dispatches to the matched command's help, or the global one.
		cli.outputHelp();
		return 0;
	}
	if (command === undefined) {
		cli.outputHelp();
		return 1;
	}
	if (!isCommand(command)) return unknownCommand(command);

	const error = validate(command, [...parsed.args], raw);
	if (error !== undefined) {
		console.error(`crust: ${error}`);
		console.error(HINT);
		return 1;
	}
	const action = cli.matchedCommand?.commandAction as
		((options: RawOptions, positional?: string) => Promise<number>) | undefined;
	if (action === undefined) return unknownCommand(command);
	try {
		return await action(raw, parsed.args[0]);
	} catch (caught) {
		const text = caught instanceof Error ? caught.message : String(caught);
		console.error(`crust ${command}: ${text}`);
		if (NO_CONFIG_PREFIXES.some((prefix) => text.startsWith(prefix))) {
			console.error(NO_CONFIG_HINT);
		}
		return 1;
	}
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
