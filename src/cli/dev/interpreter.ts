/**
 * The interpreter a runtime child is started with.
 *
 * `dev` runs the app in a child, so it needs a JavaScript engine. A compiled crust
 * already carries one: `BUN_BE_BUN=1 <executable> <script>` makes the executable behave
 * as the `bun` command, so `crust dev` works with no Bun installed anywhere. That is
 * checked before anything else, but an installed Bun wins when PATH has one, because it
 * is the interpreter the user's own project was installed with.
 *
 * `process.execPath` is not an interpreter on its own — inside a compiled executable it
 * is crust itself, which is exactly why the variable has to be set.
 */

import { inExecutable } from "../framework.ts";

export interface Interpreter {
	command: readonly string[];
	env: Record<string, string>;
}

let resolved: Interpreter | undefined;

export function interpreter(): Interpreter {
	if (resolved !== undefined) return resolved;
	const onPath = Bun.which("bun");
	if (onPath !== null) resolved = { command: [onPath], env: {} };
	else if (inExecutable()) resolved = { command: [process.execPath], env: { BUN_BE_BUN: "1" } };
	// A checkout is started by Bun (`bun src/cli/index.ts`), so execPath is a bun even
	// when PATH cannot see one — an absolute `crust` on an empty PATH still runs.
	else resolved = { command: [process.execPath], env: {} };
	return resolved;
}
