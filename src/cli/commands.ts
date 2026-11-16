/** The command table. `usage.ts` lists the same names, and `commands.test.ts` holds the two in step. */

import { build } from "./build.ts";
import { dev } from "./dev.ts";
import { dmg } from "./dmg.ts";
import { doctor } from "./doctor.ts";
import { init } from "./init.ts";
import { notarizeCommand } from "./notarize.ts";
import { packageCommand } from "./package.ts";
import { sign } from "./sign.ts";
import type { CliOptions } from "./util.ts";

/** Every command: the shared options in, a process exit code out. */
export type Handler = (options: CliOptions) => Promise<number>;

export const COMMANDS = {
	init,
	dev,
	build,
	sign,
	dmg,
	package: packageCommand,
	notarize: notarizeCommand,
	doctor,
} as const satisfies Record<string, Handler>;

export type CommandName = keyof typeof COMMANDS;

export function isCommand(name: string): name is CommandName {
	return Object.hasOwn(COMMANDS, name);
}
