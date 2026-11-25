/** Argument parsing and dispatch for the two perf verbs. cac owns the vocabulary and help. */

import { cac } from "cac";
import { diffFiles } from "./diff.ts";
import { record } from "./record.ts";

export const USAGE =
	"crust perf record --app <path-to-app-or-dir> --seconds 10 --out perf.json [--format json|text]\n" +
	"crust perf diff before.json after.json [--tolerance 5]";

const cli = cac("crust perf");
cli.command("record", "record one sample per second from a headless WebKit window")
	.option("--app <path>", "app directory, built .app bundle, or public/ directory")
	.option("--seconds <n>", "seconds to sample, 1-10 (default: 10)")
	.option("--out <path>", "sample file to write (default: perf.json)")
	.option("--format <fmt>", "stdout: text headline (default) or json");
cli.command("diff <before> <after>", "report per-field deltas with direction-aware regression gates")
	.option("--tolerance <n>", "percent a metric may move before it is a regression (default: 5)");

const VALUE_FLAGS = ["app", "seconds", "out", "format", "tolerance"];

function positionals(argv: string[]): string[] {
	const found: string[] = [];
	for (let index = 1; index < argv.length; index++) {
		const token = argv[index] ?? "";
		if (token.startsWith("--")) {
			if (VALUE_FLAGS.includes(token.slice(2).replace(/^-+/, "")) && index + 1 < argv.length) index++;
			continue;
		}
		if (!token.startsWith("-")) found.push(token);
	}
	return found;
}

const numberOption = (value: unknown, fallback: number): number =>
	value === undefined ? fallback : Number(value);

export async function runPerf(argv: string[]): Promise<number> {
	if (argv.length === 0) {
		console.error(USAGE);
		return 1;
	}
	if (argv[0] === "--help" || argv[0] === "-h" || argv.includes("--help")) {
		console.log(USAGE);
		return 0;
	}
	const parsed = cli.parse(["bun", "crust perf", ...argv], { run: false });
	const options = parsed.options as Record<string, unknown>;
	const command = argv[0];

	if (command === "record") {
		const app = options.app;
		if (typeof app !== "string" || app.length === 0) {
			console.error("crust perf record: --app <path> is required");
			console.error(USAGE);
			return 2;
		}
		const seconds = numberOption(options.seconds, 10);
		if (!Number.isFinite(seconds) || seconds < 1) {
			console.error(`crust perf record: --seconds needs a positive number, got ${String(options.seconds)}`);
			return 2;
		}
		const format = options.format ?? "text";
		if (format !== "text" && format !== "json") {
			console.error(`crust perf record: --format expects text or json, got ${String(format)}`);
			return 2;
		}
		const out = typeof options.out === "string" ? options.out : "perf.json";
		return await record({ app, seconds, out, format });
	}

	if (command === "diff") {
		const args = positionals(argv);
		if (args.length !== 2) {
			console.error("crust perf diff: expected before.json after.json");
			console.error(USAGE);
			return 1;
		}
		return await diffFiles(args[0] ?? "", args[1] ?? "", numberOption(options.tolerance, 5));
	}

	console.error(`crust perf: unknown subcommand "${command}"`);
	console.error(USAGE);
	return 1;
}
