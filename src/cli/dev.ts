/**
 * `crust dev` — the backend owns the app process, the frontend stays with its own dev server. A backend edit restarts the runtime; a frontend edit never touches it, so UI state survives. The backend runs in a child process (`dev/runtime.ts`) because the platform's `quit()` calls `process.exit` and a closing window must not take the watcher down.
 */

import { join, resolve } from "node:path";
import { loadConfig } from "@/config";
import { DEV_INSPECT_ENV } from "@/platform/darwin/devtools.ts";
import { publishReload, RELOAD_ENV, RELOAD_FILE, watchPublic } from "./dev/reload.ts";
import { extensionErrorLines, loadProjectExtensions } from "@/extensions/project.ts";
import { detectSingle } from "@/single";
import { bridgeEnv, waitForDevServer } from "./dev/frontend.ts";
import { watchRuntime } from "./dev/runtime.ts";
import { devSingle } from "./dev/single.ts";
import { fail, line, missingInstall, resolveBackendEntry, type CliOptions } from "./util.ts";

export async function dev(options: CliOptions): Promise<number> {
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

	// A dev-server page is not the bridge's document, so the client must arrive through
	// the page: `crust/vite` injects `window.__CRUST__`. The bridge's port and token
	// cannot be known before the runtime binds, so they reach the dev server through
	// `.crust/dev.json`, read per request — only that plugin can warn when neither the
	// file nor the environment holds them. These two forward an existing shell value, so
	// an operator can point the page at a bridge by hand.
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

	const runtime = {
		entry,
		projectDir,
		configPath,
		devUrl,
		env,
		extensionFiles: extensions.loaded,
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
