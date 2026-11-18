/**
 * The CLI contract, pinned end to end through the real entry point before the
 * cac rewrite lands. One table row per behaviour; each row spawns `index.ts`
 * the way `first-run.test.ts` does, because argv handling sets `process.exitCode`
 * at module load and cannot be imported twice.
 *
 * Only rows that fail before a project, certificate or display is needed are
 * here: help, version, unknown/missing-value/flag-scope errors, the init
 * refusals that reject before touching disk, and the no-config throw.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERSION } from "./util.ts";

const ENTRY = join(import.meta.dir, "index.ts");
const HELP = ["crust — a Bun-native desktop app framework", "usage:", "crust init", "crust doctor"];
const HINT = 'run "crust --help" for usage';

interface Run {
	out: string;
	err: string;
	code: number;
}

async function runCli(...args: string[]): Promise<Run> {
	const child = Bun.spawn({
		cmd: [process.execPath, "run", ENTRY, ...args],
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { out, err, code };
}

interface Row {
	name: string;
	args: string[];
	code: number;
	out?: string[];
	err?: string[];
	outNot?: string[];
	/** Pin that a stream is completely empty. */
	outEmpty?: boolean;
	errEmpty?: boolean;
	/** Replace the `<DIR>` token in args with a fresh empty temp directory. */
	freshDir?: boolean;
}

/** A success row: help or version on stdout, stderr empty. */
function ok(name: string, args: string[], out: string[], outNot: string[] = []): Row {
	return { name, args, code: 0, out, outNot, errEmpty: true };
}

/** A rejection row: a message on stderr, stdout empty. */
function bad(name: string, args: string[], err: string[], extra: Partial<Row> = {}): Row {
	return { name, args, code: 1, err, outEmpty: true, ...extra };
}

const ROWS: Row[] = [
	ok("--version prints VERSION, exit 0", ["--version"], [VERSION]),
	ok("-v is the same as --version", ["-v"], [VERSION]),
	ok("--help prints full help, exit 0", ["--help"], [...HELP, "--format", "--react"]),
	ok("-h is the same as --help", ["-h"], HELP),
	{ name: "no arguments print help but exit 1", args: [], code: 1, out: HELP, errEmpty: true },
	bad("unknown command + hint, exit 1", ["nope"], ['crust: unknown command "nope"', HINT]),
	bad(
		"a typo plus --help still exits 1, not success",
		["nope", "--help"],
		["unknown command", "nope"],
	),
	{
		name: "build --help answers only build, exit 0",
		args: ["build", "--help"],
		code: 0,
		out: ["crust build — command help", "crust build [file]", "compile the binary"],
		outNot: ["crust notarize", "crust init <dir>"],
		errEmpty: true,
	},
	bad(
		"--dir does not eat a following flag",
		["build", "--dir", "--react"],
		["--dir needs a value"],
	),
	bad(
		"--config does not eat a following flag",
		["build", "--config", "--react"],
		["--config needs a value"],
	),
	bad(
		"--entry does not eat a following flag",
		["build", "--entry", "--react"],
		["--entry needs a value"],
	),
	bad(
		"--format does not eat a following flag",
		["build", "--format", "--react"],
		["--format needs a value"],
	),
	bad(
		"a missing --dir value is a usage error",
		["build", "--dir"],
		["--dir needs a value", HINT],
	),
	bad("an unknown option is a usage error", ["build", "--wat"], ["unknown option --wat", HINT]),
	bad(
		"init with two positionals refuses the second",
		["init", "a", "b"],
		["unexpected argument b"],
	),
	bad(
		"init with a positional and --dir refuses both",
		["init", "a", "--dir", "b"],
		["init takes one directory — pass <dir> or --dir, not both"],
	),
	bad(
		"init with two scaffolds refuses, naming each",
		["init", "a", "--react", "--next"],
		[
			"crust init:",
			"--react",
			"--next",
			"choose different scaffolds",
			"React + Vite",
			"Next.js",
		],
	),
	...["react", "next", "svelte", "vue"].map<Row>((flag) =>
		bad(
			`--${flag} on a non-init command is refused`,
			["build", `--${flag}`],
			[`--${flag} only applies to init`],
		),
	),
	bad(
		"--format on a non-package command is refused",
		["build", "--format", "dmg"],
		["--format only applies to package"],
	),
	bad(
		"an unknown --format value is refused before a build",
		["package", "--format", "zip"],
		['unknown format "zip" — expected dmg | appimage | nsis'],
	),
	bad(
		"every repeated --format value is checked",
		["package", "--format", "dmg", "--format", "zip"],
		['unknown format "zip" — expected dmg | appimage | nsis'],
	),
	ok("--help answers even when another flag would fail", ["--help", "--react"], HELP),
	ok(
		"--help overrides an unknown option",
		["build", "--wat", "--help"],
		["crust build — command help"],
	),
	ok("--version short-circuits --format validation", ["--version", "--format", "dmg"], [VERSION]),
	{
		name: "a throwing command prints its message plus the init hint",
		args: ["build", "--dir", "<DIR>"],
		code: 1,
		err: ["crust build:", "no crust config", "crust init"],
		freshDir: true,
	},
];

describe("CLI contract (baseline the cac refactor must keep)", () => {
	for (const row of ROWS) {
		test(row.name, async () => {
			let dir: string | undefined;
			let args = row.args;
			if (row.freshDir) {
				dir = await mkdtemp(join(tmpdir(), "crust-contract-"));
				args = args.map((arg) => (arg === "<DIR>" ? dir! : arg));
			}
			try {
				const run = await runCli(...args);
				expect(run.code, `exit code: ${row.name}`).toBe(row.code);
				for (const text of row.out ?? []) {
					expect(run.out, `stdout contains ${text}: ${row.name}`).toContain(text);
				}
				for (const text of row.err ?? []) {
					expect(run.err, `stderr contains ${text}: ${row.name}`).toContain(text);
				}
				for (const text of row.outNot ?? []) {
					expect(run.out, `stdout omits ${text}: ${row.name}`).not.toContain(text);
				}
				if (row.outEmpty) expect(run.out, `stdout empty: ${row.name}`).toBe("");
				if (row.errEmpty) expect(run.err, `stderr empty: ${row.name}`).toBe("");
			} finally {
				if (dir) await rm(dir, { recursive: true, force: true });
			}
		});
	}
});
