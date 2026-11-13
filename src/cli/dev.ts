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
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { loadConfig } from "@/config";
import { isIgnoredWatchPath } from "@/cli/ignore";
import { buildPage, detectSingle, devRunnerSource, type SingleApp } from "@/single";
import { frameworkRoot } from "./framework.ts";
import { fail, line, resolveBackendEntry, type CliOptions } from "./util.ts";

/** Where the runtime module lives inside this package. */

export async function dev(options: CliOptions): Promise<number> {
	const detected = await detectSingle(options);
	if (detected.kind === "error") return fail("dev", detected.message);
	if (detected.kind === "app") return devSingle(detected.app);

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

async function spawnRuntime(options: RuntimeOptions) {
	return Bun.spawn({
		cmd: [
			"bun",
			join(await frameworkRoot(), "src/runtime.ts"),
			"--config",
			options.configPath,
			"--entry",
			options.entry,
		],
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

/**
 * `crust dev app.tsx` — one file, no config, one window.
 *
 * The page bundle is written to `<dir>/.crust/single` and served by the bridge
 * from disk, so a rebuild replaces files and the window reloads itself; the
 * runtime process is never restarted for a page edit. A build failure prints
 * and leaves the last good bundle in place, which is why the window survives a
 * half-typed file.
 *
 * Only the entry file is watched. A file it imports is not, and that is the
 * documented limit of this convenience (`docs/single-file.md`).
 */
async function devSingle(app: SingleApp): Promise<number> {
	console.log(`crust dev — ${app.file} (one file)`);

	// The first build is the one that can stop the launch: with no good bundle
	// there is nothing to serve, and a window on a broken page is worse than a
	// message naming the error.
	const page = await buildPage(app, { dev: true });

	const temp = await mkdtemp(join(tmpdir(), "crust-single-"));
	const runner = join(temp, "run.ts");
	await writeFile(runner, devRunnerSource(app, page.dir), "utf8");

	line("page", join(page.dir, "index.html"));
	line("bundle", `${page.entry} (rebuilt on every change)`);
	line("window", `${app.config.windows[0]?.width}x${app.config.windows[0]?.height}`);
	line("invoke", 'window.crust.invoke("info") answers from the framework');
	console.log("");

	const child = Bun.spawn({
		cmd: ["bun", runner],
		cwd: app.dir,
		stdio: ["inherit", "inherit", "inherit"],
	});

	let stopping = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let building = false;
	let again = false;

	const rebuild = async (): Promise<void> => {
		if (stopping) return;
		if (building) {
			again = true;
			return;
		}
		building = true;
		try {
			await buildPage(app, { dev: true });
			line("page", "rebuilt — the window reloads itself");
		} catch (error) {
			// The written page is untouched by a failed build, so the window keeps
			// the last good bundle and only this message appears.
			console.error("  page      build failed — the last good page stays");
			const text = error instanceof Error ? error.message : String(error);
			for (const row of text.split("\n")) console.error(`            ${row}`);
		} finally {
			building = false;
			if (again) {
				again = false;
				void rebuild();
			}
		}
	};

	const name = basename(app.file);
	const watcher = watch(app.dir, { recursive: false }, (_event, filename) => {
		if (stopping) return;
		const seen = String(filename ?? "");
		if (seen !== name && !seen.endsWith(`/${name}`)) return;
		clearTimeout(timer);
		timer = setTimeout(() => {
			void rebuild();
		}, 120);
	});

	const stop = (): void => {
		stopping = true;
		clearTimeout(timer);
		watcher.close();
		child.kill();
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);

	const code = await child.exited;
	watcher.close();
	clearTimeout(timer);
	await rm(temp, { recursive: true, force: true }).catch(() => undefined);

	if (code === 0) {
		line("app", "window closed; crust dev stopped");
		return 0;
	}
	line("app", `runtime exited with ${code}`);
	return code ?? 1;
}
