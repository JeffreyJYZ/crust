/**
 * `crust dev` — the backend owns the app process, the frontend stays with its
 * own dev server.
 *
 * A backend edit restarts the runtime process. A frontend edit never touches
 * it: HMR is the dev server's job, so UI state survives. The backend runs in a
 * child process because the platform's `quit()` calls `process.exit`, and the
 * window closing must not take the watcher down with it.
 */
import { watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadConfig } from "@/config";
import { crustRoot, fail, line, resolveBackendEntry, type CliOptions } from "./util.ts";

/** Where the runtime module lives inside this package. */
const RUNTIME_ENTRY = resolve(crustRoot, "src/runtime.ts");

export async function dev(options: CliOptions): Promise<number> {
	const loaded = await loadConfig({ dir: options.dir, configPath: options.config });
	console.log(`crust dev — ${loaded.path}`);
	const config = loaded.config;

	const backend = await resolveBackendEntry(options.dir, options.entry);
	if (!backend) {
		return fail(
			"dev",
			options.entry
				? `backend entry ${options.entry} does not exist under ${options.dir}`
				: `no backend entry in ${options.dir} — expected src/main.ts or main.ts`,
		);
	}
	const entry = backend.path;

	const devUrl = config.dev?.url;
	if (devUrl) line("frontend", `${devUrl} (HMR stays with the dev server)`);
	else line("frontend", "served by the bridge (public/index.html, no dev server)");

	// A dev-server page is not the bridge's document, so the client has to
	// arrive through the page itself: `crust/vite` injects `window.__CRUST__`
	// from these two variables. The runtime owns the port and the token, so it
	// is the process that publishes them; this is the one place that hands the
	// No warning here: the bridge's port and token cannot be known before the
	// runtime binds, so they reach a dev server through `.crust/dev.json`, which
	// the Vite plugin reads per request. `crust/vite` warns if neither source
	// exists, which is the only place that can tell.
	const env = bridgeEnv(devUrl);

	const projectDir = resolve(options.dir);
	const configPath = resolve(projectDir, loaded.path);

	let frontend: ReturnType<typeof Bun.spawn> | undefined;
	const beforeDevCommand = config.dev?.beforeDevCommand;
	if (beforeDevCommand) {
		line("before", beforeDevCommand);
		// Started, not awaited: a dev server does not exit. Its own output is
		// inherited so Vite's banner and HMR messages stay visible.
		frontend = Bun.spawn({
			cmd: ["sh", "-c", beforeDevCommand],
			cwd: projectDir,
			stdio: ["inherit", "inherit", "inherit"],
			env: { ...process.env, ...env },
		});
	}

	const runtime = {
		entry,
		projectDir,
		configPath,
		devUrl,
		env,
	};

	console.log("");
	const code = await watchRuntime(runtime);
	frontend?.kill();
	return code;
}

interface RuntimeOptions {
	entry: string;
	projectDir: string;
	configPath: string;
	devUrl?: string;
	/** The bridge pair to publish, when a `dev.url` page needs it. */
	env?: Record<string, string>;
}

function spawnRuntime(options: RuntimeOptions) {
	return Bun.spawn({
		cmd: ["bun", RUNTIME_ENTRY, "--config", options.configPath, "--entry", options.entry],
		cwd: options.projectDir,
		stdio: ["inherit", "inherit", "inherit"],
		env: { ...process.env, ...options.env, CRUST_DEV_URL: options.devUrl ?? "" },
	});
}

/**
 * The pair `crust/vite` reads, taken from this process's own environment.
 *
 * Both are empty for a `dev.url` app whose runtime has not published a bridge
 * address yet; the caller turns that into one line rather than a page that
 * fails its first invoke with no explanation.
 */
function bridgeEnv(devUrl: string | undefined): Record<string, string> {
	if (devUrl === undefined) return {};
	const url = process.env.CRUST_BRIDGE_URL?.trim() ?? "";
	const token = process.env.CRUST_BRIDGE_TOKEN?.trim() ?? "";
	if (url.length === 0 || token.length === 0) return {};
	return { CRUST_BRIDGE_URL: url, CRUST_BRIDGE_TOKEN: token };
}

/**
 * Run the runtime, restarting it on a backend file change. The watch covers
 * the backend entry's directory, which is where `main.ts` and anything it
 * imports live; a change under `public/` is HMR's and is ignored.
 */
async function watchRuntime(options: RuntimeOptions): Promise<number> {
	let child = spawnRuntime(options);
	let stopping = false;
	let restarting = false;
	let wake: (() => void) | undefined;
	let restartTimer: ReturnType<typeof setTimeout> | undefined;

	const watcher = watch(dirname(options.entry), { recursive: true }, (_event, filename) => {
		if (stopping || restarting) return;
		// Frontend assets and build output are not backend code: `public/` is the
		// bridge's to serve fresh, `dist/` is a build result, and both would
		// otherwise restart the process for a change HMR should own.
		if (/(^|[/\\])(public|dist|node_modules)([/\\]|$)/.test(String(filename ?? ""))) return;
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
			child = spawnRuntime(options);
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
		child = spawnRuntime(options);
	}
}
