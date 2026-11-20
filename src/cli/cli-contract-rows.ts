/** The one table of CLI contract rows. The runner lives in cli-contract.test.ts. */

import { VERSION } from "./util.ts";

export const HELP = [
	"crust — a Bun-native desktop app framework",
	"usage:",
	"crust init",
	"crust doctor",
];
export const HINT = 'run "crust --help" for usage';

export interface Row {
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
	/** Environment overrides, so credential refusals do not depend on this machine. */
	env?: Record<string, string>;
}

/** A success row: help or version on stdout, stderr empty. */
function ok(name: string, args: string[], out: string[], outNot: string[] = []): Row {
	return { name, args, code: 0, out, outNot, errEmpty: true };
}

/** A rejection row: a message on stderr, stdout empty. */
function bad(name: string, args: string[], err: string[], extra: Partial<Row> = {}): Row {
	return { name, args, code: 1, err, outEmpty: true, ...extra };
}

export const ROWS: Row[] = [
	ok("--version prints VERSION, exit 0", ["--version"], [VERSION]),
	ok("-v is the same as --version", ["-v"], [VERSION]),
	ok(
		"--help prints full help, exit 0",
		["--help"],
		[...HELP, "--format", "--react", "--sign", "--notarize", "--dmg"],
	),
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
		out: [
			"crust build — command help",
			"crust build [file]",
			"compile the binary",
			"--sign",
			"--notarize",
			"--dmg",
		],
		outNot: ["crust sign", "crust notarize", "crust dmg", "crust init <dir>"],
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
	...["react", "next", "svelte", "vue", "solid"].map<Row>((flag) =>
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
	...["sign", "dmg", "notarize"].map<Row>((verb) =>
		bad(
			`crust ${verb} is no longer a command`,
			[verb, "--help"],
			[`crust: unknown command "${verb}"`, HINT],
		),
	),
	...["sign", "notarize", "dmg"].map<Row>((flag) =>
		bad(
			`--${flag} on a non-build command is refused`,
			["init", `--${flag}`],
			[`--${flag} only applies to build`],
		),
	),
	bad(
		"build --notarize without --sign is refused by name",
		["build", "--notarize"],
		["notarize requires --sign", "ad-hoc"],
		{ env: { CRUST_SIGNING_IDENTITY: "" } },
	),
	bad(
		"build --sign with no identity is refused by name",
		["build", "--sign"],
		["sign requires CRUST_SIGNING_IDENTITY", "Developer ID Application: Name (TEAMID)"],
		{ env: { CRUST_SIGNING_IDENTITY: "" } },
	),
	bad(
		"build --sign --notarize with no credential is refused by name",
		["build", "--sign", "--notarize"],
		["notarize requires notarytool credentials", "appleId + password"],
		{
			env: {
				CRUST_SIGNING_IDENTITY: "Developer ID Application: Crust (ABCDE12345)",
				CRUST_NOTARY_PROFILE: "",
				CRUST_NOTARY_APPLE_ID: "",
				CRUST_NOTARY_PASSWORD: "",
				CRUST_NOTARY_TEAM_ID: "",
			},
		},
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
