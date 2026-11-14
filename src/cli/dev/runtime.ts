/**
 * The runtime child and its watcher: a backend edit restarts it, a frontend
 * edit never touches it. The backend runs in a child process because the
 * platform's `quit()` calls `process.exit`, and the window closing must not
 * take the watcher down with it.
 */

import { watch } from "node:fs";
import { dirname, join } from "node:path";
import { isFrontendSource, isIgnoredWatchPath } from "../ignore.ts";
import { projectCrustRoot } from "../framework.ts";
import { line } from "../util.ts";
import { interpreter } from "./interpreter.ts";

export interface RuntimeOptions {
	entry: string;
	projectDir: string;
	configPath: string;
	devUrl?: string;
	/** The bridge pair to publish, when a `dev.url` page needs it. */
	env?: Record<string, string>;
}

export async function spawnRuntime(options: RuntimeOptions) {
	const run = interpreter();
	return Bun.spawn({
		cmd: [
			...run.command,
			join(await projectCrustRoot(options.projectDir), "src/runtime.ts"),
			"--config",
			options.configPath,
			"--entry",
			options.entry,
		],
		cwd: options.projectDir,
		stdio: ["inherit", "inherit", "inherit"],
		env: {
			...process.env,
			...run.env,
			...options.env,
			CRUST_DEV_URL: options.devUrl ?? "",
		},
	});
}

/**
 * Run the runtime, restarting it on a backend file change. The watch covers
 * the backend entry's directory, which is where `main.ts` and anything it
 * imports live; a change under `public/` is HMR's and is ignored.
 */
export async function watchRuntime(options: RuntimeOptions): Promise<number> {
	let child = await spawnRuntime(options);
	let stopping = false;
	let restarting = false;
	let wake: (() => void) | undefined;
	let restartTimer: ReturnType<typeof setTimeout> | undefined;

	const watcher = watch(dirname(options.entry), { recursive: true }, (_event, filename) => {
		if (stopping || restarting) return;
		// Frontend assets and build output are not backend code: `public/` is the
		// bridge's to serve fresh, `dist/` is a build result, `.next/` and `out/`
		// are a framework's own output, and `.crust/` is crust's scratch. A change
		// in any of them would otherwise restart the backend for a change the
		// frontend should own — and a restart rotates the bridge token, so the
		// loaded page then fails with a missing bearer token.
		if (isIgnoredWatchPath(filename)) return;
		// A dev-server project's backend entry sits at the project root, so the watch
		// covers every UI file too. Editing one restarted the runtime — rotating the
		// bridge token and rebuilding the window — while the dev server's own reload was
		// already handling that file. Frontend extensions are its business, not ours.
		if (options.devUrl !== undefined && isFrontendSource(filename)) return;
		clearTimeout(restartTimer);
		restartTimer = setTimeout(() => {
			if (wake) {
				const resume = wake;
				wake = undefined;
				resume();
				return;
			}
			console.log("  restart   backend changed");
			restarting = true;
			child.kill();
		}, 150);
	});

	const stop = (): void => {
		stopping = true;
		clearTimeout(restartTimer);
		watcher.close();
		wake?.();
		child.kill();
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);

	while (true) {
		const code = await child.exited;
		if (stopping) return 0;
		if (restarting) {
			restarting = false;
			child = await spawnRuntime(options);
			continue;
		}
		if (code === 0) {
			line("backend", "exited cleanly; crust dev stopped");
			watcher.close();
			return 0;
		}
		line("backend", `exited with ${code}; waiting for a change`);
		await new Promise<void>((resolve) => {
			wake = resolve;
		});
		if (stopping) return 0;
		child = await spawnRuntime(options);
	}
}
