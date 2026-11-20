/**
 * The runtime child `crust dev` runs, and the generated entry that spawns it: everything about
 * starting one child, split out of `runtime.ts` when the per-run frame directory pushed it past the
 * line cap. `runtime.ts` owns only the watch and the restart loop.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { projectCrustRoot } from "../framework.ts";
import { devEntrySource } from "./entry.ts";
import { interpreter } from "./interpreter.ts";

export interface RuntimeOptions {
	entry: string;
	projectDir: string;
	configPath: string;
	devUrl?: string;
	/** The bridge pair to publish, when a `dev.url` page needs it. */
	env?: Record<string, string>;
	/** Extension files that loaded from disk; empty spawns the plain runtime. */
	extensionFiles?: readonly string[];
	/** The project's `native/` source dir, when it exists. Edit there rebuilds the dylib. */
	nativeDir?: string;
	/**
	 * This run's window-frame directory, created once and shared by every restarted child so the
	 * window reopens where the human left it. Removed when the run ends, which is why a fresh
	 * `crust dev` opens at the configured size.
	 */
	frameDir?: string;
}

export async function spawnRuntime(options: RuntimeOptions) {
	const run = interpreter();
	const crust = await projectCrustRoot(options.projectDir);
	const generated = await devEntryPath(options, crust);
	return Bun.spawn({
		cmd:
			generated === undefined
				? [
						...run.command,
						join(crust, "src/runtime.ts"),
						"--config",
						options.configPath,
						"--entry",
						options.entry,
					]
				: [...run.command, generated],
		cwd: options.projectDir,
		stdio: ["inherit", "inherit", "inherit"],
		env: {
			...process.env,
			...run.env,
			...options.env,
			CRUST_DEV_URL: options.devUrl ?? "",
			// The logging default in a dev run is the logger's own `info`, and `CRUST_LOG` is already
			// in `process.env` when `--log-level` or a shell set it. Every written record streams to
			// this terminal.
			CRUST_DEV: "1",
			// Only a `crust dev` run has one. Absent, the app opens at its configured size and
			// remembers nothing, which is what a build output gets.
			...(options.frameDir === undefined ? {} : { CRUST_WINDOW_STATE_DIR: options.frameDir }),
		},
	});
}

/**
 * The generated entry, written into `.crust/dev` — crust's own scratch, which the watcher ignores,
 * so writing it never restarts the runtime it feeds. `undefined` for a project with no extensions,
 * which keeps the plain `src/runtime.ts --config … --entry …` argv every project used before.
 */
async function devEntryPath(options: RuntimeOptions, crust: string): Promise<string | undefined> {
	const files = options.extensionFiles ?? [];
	if (files.length === 0) return undefined;
	const path = join(options.projectDir, ".crust", "dev", "entry.ts");
	await mkdir(dirname(path), { recursive: true });
	await writeFile(
		path,
		devEntrySource({
			configPath: options.configPath,
			entryPath: options.entry,
			runtimePath: join(crust, "src/runtime.ts"),
			extensionsPath: join(crust, "src/extensions/registry.ts"),
			projectDir: options.projectDir,
			extensionFiles: files,
		}),
		"utf8",
	);
	return path;
}
