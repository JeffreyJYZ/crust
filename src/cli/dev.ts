/**
 * `crust dev` — the backend owns the app process, the frontend stays with its
 * own dev server.
 *
 * A backend edit restarts the runtime process. A frontend edit never touches
 * it: HMR is the dev server's job, so UI state survives. The backend runs in a
 * child process (see `dev/runtime.ts`) because the platform's `quit()` calls
 * `process.exit`, and the window closing must not take the watcher down with it.
 */

import { resolve } from "node:path";
import { loadConfig } from "@/config";
import { detectSingle } from "@/single";
import { bridgeEnv, waitForDevServer } from "./dev/frontend.ts";
import { watchRuntime } from "./dev/runtime.ts";
import { devSingle } from "./dev/single.ts";
import { fail, line, missingInstall, resolveBackendEntry, type CliOptions } from "./util.ts";

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
	// arrive through the page itself: `crust/vite` injects `window.__CRUST__`.
	// The bridge's port and token cannot be known before the runtime binds, so
	// they reach the dev server through `.crust/dev.json`, which the plugin
	// reads per request — `crust/vite` is the only place that can warn when
	// neither that file nor an explicit environment holds them. These two are
	// forwarded when a shell already has them, so an operator can point the
	// page at a bridge by hand.
	const env = bridgeEnv(devUrl);

	const projectDir = resolve(options.dir);
	const configPath = resolve(projectDir, loaded.path);

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

	console.log("");
	const code = await watchRuntime(runtime);
	frontend?.kill();
	return code;
}
