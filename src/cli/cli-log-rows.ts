/** The `--log-level` contract rows, split out so the main row table stays under the line cap. */

import { bad, HINT, ok, type Row } from "./cli-row-shape.ts";

export const LOG_ROWS: Row[] = [
	ok("dev --help names --log-level", ["dev", "--help"], ["crust dev", "--log-level"]),
	bad(
		"--log-level on a non-dev command is refused",
		["build", "--log-level", "debug"],
		["--log-level only applies to dev"],
	),
	bad(
		"an unknown log level is refused by name, not quietly defaulted",
		["dev", "--log-level", "verbose"],
		['unknown log level "verbose"', "trace, debug, info, warn or error"],
	),
	bad("--log-level needs a value", ["dev", "--log-level"], ["--log-level needs a value", HINT]),
];
