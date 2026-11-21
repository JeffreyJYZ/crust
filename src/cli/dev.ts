/**
 * `crust dev` — the backend owns the app process, the frontend stays with its own dev server. A backend edit restarts the runtime; a frontend edit never touches it, so UI state survives. The backend runs in a child process (`dev/runtime.ts`) because the platform's `quit()` calls `process.exit` and a closing window must not take the watcher down.
 */

import { join, resolve } from "node:path";
import { devCspNotice } from "@/bridge/server/csp.ts";
import { loadConfig } from "@/config";
import { DEV_INSPECT_ENV } from "@/platform/darwin/devtools.ts";
import { publishReload, RELOAD_ENV, RELOAD_FILE, watchPublic } from "./dev/reload.ts";
import { extensionErrorLines, loadProjectExtensions } from "@/extensions/project.ts";
import { detectSingle } from "@/single";
import { bridgeEnv, waitForDevServer } from "./dev/frontend.ts";
import { watchRuntime } from "./dev/runtime.ts";
import { devSingle } from "./dev/single.ts";
import { exists, fail, line, missingInstall, type CliOptions } from "./util.ts";

/**
 * The module script the page loads, as a project-relative path. A Vite scaffold names its
 * *frontend* entry here — `src/main.ts` on Svelte and Vue — which collides with crust's own
 * `src/main.ts` backend convention. Importing that browser entry in the runtime child throws
 * `document is not defined` before a window opens (measured on both scaffolds).
 */
export async function htmlModuleEntry(dir: string): Promise<string | undefined> {
	const html = await Bun.file(join(dir, "index.html"))
		.text()
		.catch(() => undefined);
	if (html === undefined) return undefined;
	for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
		if (!/\btype=["']module["']/.test(tag)) continue;
		const src = tag.match(/\bsrc=["']([^"']+)["']/)?.[1];
		if (src) return src.replace(/^\/+/, "");
	}
	return undefined;
}

/**
 * `resolveBackendEntry` plus one rule: when the page's own HTML names `src/main.ts` as its
 * module, that file is the frontend, so the backend is `main.ts` at the project root. An
 * explicit `--entry` still wins. This keeps the resolution in dev, before the runtime child
 * is spawned, rather than letting the child import a browser module and die on `document`.
 */
export async function devBackendEntry(
	dir: string,
	explicit?: string,
): Promise<{ path: string; explicit: boolean } | undefined> {
	if (explicit) {
		const path = resolve(dir, explicit);
		return (await exists(path)) ? { path, explicit: true } : undefined;
	}
	const pageEntry = await htmlModuleEntry(dir);
	for (const candidate of ["src/main.ts", "main.ts"]) {
		if (pageEntry !== undefined && candidate === pageEntry) continue;
		const path = resolve(dir, candidate);
		if (await exists(path)) return { path, explicit: false };
	}
	return undefined;
}

export async function dev(options: CliOptions): Promise<number> {
	// The loudest source becomes the env the runtime child reads, because `spawn.ts` forwards
	// `process.env` to every child and a single-file run forks its own. So `--log-level` beats a
	// shell's `CRUST_LOG`, and the child needs no third mechanism.
	if (options.logLevel !== undefined) process.env.CRUST_LOG = options.logLevel;
	const detected = await detectSingle(options);
	if (detected.kind === "error") return fail("dev", detected.message);
	// Every dev path spawns a runtime child that inherits process.env, so this is the same
	// dev-only signal the reload file uses: darwin window creation turns it into an inspectable
	// webview. A built app never sets it. Set before the single-file path forks its child too.
	process.env[DEV_INSPECT_ENV] = "1";
	if (detected.kind === "app") return devSingle(detected.app);

	const loaded = await loadConfig({ dir: options.dir, configPath: options.config });
	console.log(`crust dev — ${loaded.path}`);
	const config = loaded.config;

	const backend = await devBackendEntry(options.dir, options.entry);
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
	// A dev-server page carries no crust policy — that server sets the headers — so this is the only
	// moment a page author can learn that the built app will enforce `DEFAULT_CSP`, not the dev run.
	if (devUrl) line("security", devCspNotice(devUrl, config.security?.csp));

	// A dev-server page is not the bridge's document, so the client must arrive through
	// the page: `crust/vite` injects `window.__CRUST__`. The runtime mints one document token
	// (never the seed) where the bridge binds and writes it to `.crust/dev.json`, which the
	// plugin reads per document. These two forward an existing shell value, so an operator can
	// point the page at a bridge by hand.
	const env = bridgeEnv(devUrl);

	const projectDir = resolve(options.dir);
	const configPath = resolve(projectDir, loaded.path);

	// The same resolution `crust build` runs — the config's `extensions`, else `<project>/extensions`
	// — so an extension cannot load under `crust dev` and vanish from a build. A broken file is
	// printed and dev keeps running: one typo must not cost the window that is already open.
	const extensions = await loadProjectExtensions({ projectDir, names: config.extensions });
	if (extensions.files.length > 0) {
		const count = extensions.files.length;
		line(
			"extensions",
			`${extensions.loaded.length} of ${count} file${count === 1 ? "" : "s"} loaded`,
		);
	}
	for (const text of extensionErrorLines(extensions.errors)) {
		console.error(`  extensions ${text}`);
	}

	let frontend: ReturnType<typeof Bun.spawn> | undefined;
	const beforeDevCommand = config.dev?.beforeDevCommand;
	if (beforeDevCommand) {
		// Same rule as `build`: a declared dependency set with no node_modules means the
		// dev server would be resolved from a global cache, and the failure would arrive
		// as a bundler stack rather than as "run bun install".
		const needsInstall = await missingInstall(projectDir);
		if (needsInstall) return fail("dev", needsInstall);
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

	// `native/` is the source a native extension compiles from, not a config key. Watch it only
	// when it exists: fs.watch throws ENOENT on a missing dir, and a project with no native
	// extensions has nothing to restart for.
	const nativeDir = resolve(projectDir, "native");
	const runtime = {
		entry,
		projectDir,
		configPath,
		devUrl,
		ignore: config.dev?.ignore,
		env,
		extensionFiles: extensions.loaded,
		nativeDir: (await exists(nativeDir, "dir")) ? nativeDir : undefined,
	};

	// The window loads `dev.url` once, when it is created, with no retry. On a cold
	// start Vite needs 0.7–1.1 s to listen, while the window appears at 0.2–0.4 s, so the
	// page request was issued into a closed port and nothing ever loaded it — measured at
	// 4 of 8 runs, and 4 of 4 from a scratch directory with no pre-bundled dependencies.
	if (devUrl !== undefined) {
		const ready = await waitForDevServer(devUrl, 30_000);
		if (!ready) {
			frontend?.kill();
			return fail(
				"dev",
				`${devUrl} did not accept a connection within 30 s — the window loads it once and ` +
					"cannot retry, so nothing would render. Check the beforeDevCommand output above",
			);
		}
		line("frontend", `${devUrl} answered`);
	}

	// No dev server means nothing reloads the page: watch public/ and advance a token
	// the bridge turns into one `dev:reload` event. The scratch file sits under .crust/,
	// which the backend watcher ignores, so a reload never rotates the bridge token.
	// Under dev.url there is no watcher at all — Vite already owns reload.
	let reloadWatcher: ReturnType<typeof watchPublic>;
	if (devUrl === undefined) {
		const file = join(projectDir, RELOAD_FILE);
		let token = 0;
		process.env[RELOAD_ENV] = file;
		void publishReload(file, String(token));
		reloadWatcher = watchPublic(projectDir, devUrl, async () => {
			await publishReload(file, String(++token));
		});
	}

	console.log("");
	try {
		return await watchRuntime(runtime);
	} finally {
		reloadWatcher?.close();
		delete process.env[RELOAD_ENV];
		delete process.env[DEV_INSPECT_ENV];
		frontend?.kill();
	}
}
