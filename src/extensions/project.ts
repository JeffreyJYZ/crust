/**
 * One answer to "which extensions does this project have, and which of them are broken", for both
 * `crust dev` and `crust build`. The directory and the config's `extensions` list are the same two
 * inputs `src/cli/build.ts` resolves with, so a project cannot load in dev and vanish in a build —
 * and the failure sentences are spelled once, here, because a dev run prints the same text the build
 * refuses with.
 */

import { join } from "node:path";
import {
	DEFAULT_EXTENSIONS_DIR,
	type ExtensionError,
	type LoadedExtensions,
	loadExtensions,
	NO_SUCH_FILE,
} from "./load.ts";

export interface ProjectExtensionsOptions {
	/** The project root; `crust` runs with it as its cwd, and `--dir` names another. */
	projectDir: string;
	/** The config's `extensions`; absent means discover `<project>/extensions/*.ts`. */
	names?: readonly string[];
}

/**
 * Resolve and load the project's extensions. A broken file is collected into `errors`, never
 * thrown: `crust dev` prints them and keeps the runtime it already has.
 */
export async function loadProjectExtensions(
	options: ProjectExtensionsOptions,
): Promise<LoadedExtensions> {
	return await loadExtensions({
		dir: join(options.projectDir, DEFAULT_EXTENSIONS_DIR),
		names: options.names,
	});
}

/**
 * The sentence `crust build` refuses a missing config entry with. `src/cli/build.ts` writes it
 * inline; it is repeated here so the dev path names the same failure the same way, and a test pins
 * the two spellings together.
 */
export function missingExtensionEntry(file: string): string {
	return `extensions entry ${file} does not exist`;
}

/** One printable line per failure, `file: reason`, except a missing entry in the build's words. */
export function extensionErrorLines(errors: readonly ExtensionError[]): string[] {
	return errors.map((error) =>
		error.reason === NO_SUCH_FILE
			? missingExtensionEntry(error.file)
			: `${error.file}: ${error.reason}`,
	);
}
