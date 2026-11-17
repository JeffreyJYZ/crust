/**
 * Plain-HTML dev reload, driver side. With no `dev.url` there is no bundler, so
 * `crust dev` watches `public/` and advances a token in `<project>/.crust/dev-reload`.
 * The bridge watches that token and emits `dev:reload`; `installCrust` listens for
 * it and reloads the window. Nothing here restarts the backend or rotates its token.
 */

import { watch } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEV_RELOAD_EVENT, RELOAD_ENV, RELOAD_FILE } from "@/bridge/server/events.ts";

export { DEV_RELOAD_EVENT, RELOAD_ENV, RELOAD_FILE };

/** One reload per burst of writes, not one per `fs.watch` callback. */
export const RELOAD_DEBOUNCE_MS = 120;

/** A change reloads only with no dev server and a still-servable document. */
export function reloadGate(devUrl: string | undefined, healthy: boolean): boolean {
	return devUrl === undefined && healthy;
}

/** The "rebuild of public/ succeeded" check: a document is still on disk and readable. */
export async function publicHealthy(publicDir: string): Promise<boolean> {
	try {
		// Read, not just stat: a half-written or unreadable document is a failed rebuild.
		return (await readFile(join(publicDir, "index.html"), "utf8")).trim().length > 0;
	} catch {
		return false;
	}
}

/** Advance the signal token. False means the scratch file could not be written. */
export async function publishReload(file: string, token: string): Promise<boolean> {
	try {
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, token, "utf8");
		return true;
	} catch {
		return false;
	}
}

export interface ReloadWatcher {
	close(): void;
}

/** Watch `public/` only for a project the bridge serves. `undefined` under `dev.url`. */
export function watchPublic(
	projectDir: string,
	devUrl: string | undefined,
	publish: () => Promise<void>,
): ReloadWatcher | undefined {
	if (devUrl !== undefined) return undefined;
	const publicDir = join(projectDir, "public");
	let timer: ReturnType<typeof setTimeout> | undefined;
	let closed = false;
	let watcher;
	try {
		watcher = watch(publicDir, { recursive: true }, () => {
			if (closed) return;
			clearTimeout(timer);
			timer = setTimeout(() => {
				void (async () => {
					if (closed || !(await publicHealthy(publicDir))) return;
					await publish();
				})();
			}, RELOAD_DEBOUNCE_MS);
		});
	} catch {
		// No public/ directory yet: nothing for the bridge to serve or reload.
		return undefined;
	}
	return {
		close() {
			closed = true;
			clearTimeout(timer);
			watcher.close();
		},
	};
}
