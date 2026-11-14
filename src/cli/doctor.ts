/**
 * `crust doctor` — report the state of everything the app needs, in the order a failure actually happens: platform, runtime, config (or the single file), shim, the app's own bridge port, the dev server's port and URL, entry, the watcher's `.ts` trap, window layer, the known-fatal traps, what a build would embed, scaffolding, bundle.
 * The checks live one file per group (`doctor/environment.ts`, `doctor/bridge.ts`, …); this file keeps the order and the exit code.
 */

import { resolve } from "node:path";
import { checkBackend, checkSingle } from "./doctor/backend.ts";
import { checkBridge } from "./doctor/bridge.ts";
import { checkAssets, checkTemplates } from "./doctor/build-assets.ts";
import { checkBundle } from "./doctor/bundle.ts";
import { type Check, type Status } from "./doctor/check.ts";
import { checkDevServer } from "./doctor/dev-port.ts";
import { checkEnvironment } from "./doctor/environment.ts";
import { checkShim, checkWindow } from "./doctor/platform.ts";
import { scanTraps } from "./doctor/scan.ts";
import { checkWatcher } from "./doctor/watch.ts";
import { line, type CliOptions } from "./util.ts";

export { preferredPort } from "./doctor/bridge.ts";
export {
	type DevPortFacts,
	type DevUrlTarget,
	classifyDevPort,
	devUrlTarget,
} from "./doctor/dev-port.ts";
export { checkAssets, checkTemplates } from "./doctor/build-assets.ts";
export { pageSideTypeScript, watcherNote } from "./doctor/watch.ts";

export async function doctor(options: CliOptions): Promise<number> {
	const checks: Check[] = [];
	const push = (name: string, status: Status, detail: string): void => {
		checks.push({ name, status, detail });
	};

	// Platform, runtime, the macOS floor, and the config (or the single file).
	const environment = await checkEnvironment(options);
	checks.push(...environment.checks);
	const { config, single } = environment;

	// The C shim, compiled exactly as the platform compiles it at launch.
	const shim = await checkShim();
	push(shim.name, shim.status, shim.detail);

	// The loopback bridge, on the port the app itself will use.
	const bridge = await checkBridge(config?.app.id ?? single?.config.app.id);
	push(bridge.name, bridge.status, bridge.detail);

	// Dev server port and reachability, only when the config names one.
	if (config?.dev?.url) checks.push(...(await checkDevServer(config.dev.url)));

	// Backend entry, then the watcher note for a page written as `.ts`.
	const backend = await checkBackend(options, single);
	push(backend.check.name, backend.check.status, backend.check.detail);
	if (config?.dev?.url) {
		const note = await checkWatcher(options.dir, backend.entryPath);
		if (note) push(note.name, note.status, note.detail);
	}

	// The page bundle a single file produces, built the way `crust dev` builds it.
	if (single) {
		const bundled = await checkSingle(options.dir, single);
		push(bundled.name, bundled.status, bundled.detail);
	}

	// Window layer. Importing it is the check: a compiled executable carries the
	// module and has no file on disk to stat, so a path check would report a failure
	// for a build that works.
	const window = await checkWindow();
	push(window.name, window.status, window.detail);

	// The three known-fatal traps, named only when the project hits one.
	for (const trap of await scanTraps(resolve(options.dir))) {
		push(trap.name, trap.status, trap.detail);
	}

	// What a build would embed: the failure behind a built app's blank window.
	if (config) {
		const assets = await checkAssets(options.dir, config);
		push(assets.name, assets.status, assets.detail);
	} else if (single) {
		push(
			"assets",
			"note",
			"not checked: single-file mode embeds the page it bundles, so there is no build.assets to read",
		);
	} else {
		push("assets", "note", "not checked: no valid config to read build.assets from");
	}

	// The scaffolds ship in the package; a tarball without them breaks init.
	const templates = await checkTemplates();
	push(templates.name, templates.status, templates.detail);

	// Bundle and its Gatekeeper consequence.
	for (const bundle of await checkBundle(options.dir)) {
		push(bundle.name, bundle.status, bundle.detail);
	}

	console.log(`crust doctor — ${options.dir}`);
	for (const check of checks) {
		line(check.name, `[${check.status}] ${check.detail}`);
	}

	const failures = checks.filter((check) => check.status === "fail").length;
	if (failures > 0) {
		console.error(`\n${failures} check${failures === 1 ? "" : "s"} failed`);
		return 1;
	}
	console.log("\nall checks passed");
	return 0;
}
