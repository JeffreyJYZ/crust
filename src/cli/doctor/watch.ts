/**
 * The backend watcher's `.ts` trap: a dev-server project whose page code is
 * TypeScript restarts the runtime on every save and rotates the bridge token.
 */

import { extname, resolve } from "node:path";
import { isIgnoredWatchPath } from "../ignore.ts";
import type { Check } from "./check.ts";
import { projectSources } from "./scan.ts";

/** A config, test or declaration file is not page code, whatever its extension. */
const NOT_PAGE_CODE = /\.(?:config|test|spec|d)\.ts$/i;

/**
 * Page-side `.ts` modules the backend watcher will treat as backend code.
 *
 * `crust dev` skips frontend extensions (`.tsx`, `.jsx`, `.css`, …) for a
 * `dev.url` project, but `.ts` is deliberately not among them because the
 * backend entry is one. A page module written as `.ts` therefore restarts the
 * runtime on every save and rotates the bridge token. The entry, config, test,
 * declaration and watched-out paths are excluded; what remains is the trap.
 */
export async function pageSideTypeScript(dir: string, entry?: string): Promise<string[]> {
	const root = resolve(dir);
	const entryPath = entry === undefined ? undefined : resolve(root, entry);
	const found: string[] = [];
	for (const relative of await projectSources(root)) {
		if (extname(relative).toLowerCase() !== ".ts") continue;
		if (NOT_PAGE_CODE.test(relative)) continue;
		if (isIgnoredWatchPath(relative)) continue;
		if (entryPath !== undefined && resolve(root, relative) === entryPath) continue;
		found.push(relative);
	}
	return found.sort();
}

/** The watcher note: a count and the first few names, never a lecture. */
export function watcherNote(files: string[]): Check {
	const shown = files.slice(0, 3).join(", ");
	const rest = files.length > 3 ? `, +${files.length - 3} more` : "";
	const plural = files.length === 1 ? "" : "s";
	return {
		name: "dev watch",
		status: "note",
		detail:
			`${files.length} page-side .ts file${plural} (${shown}${rest}) — the watcher skips .tsx/.jsx/.css ` +
			"but not .ts, so saving one restarts the backend and rotates the bridge token; rename them .tsx, " +
			"or move them under a skipped directory such as public/",
	};
}

/** The note line for a dev-server project, or none when nothing is exposed. */
export async function checkWatcher(dir: string, entry?: string): Promise<Check | undefined> {
	const pageSide = await pageSideTypeScript(dir, entry);
	return pageSide.length > 0 ? watcherNote(pageSide) : undefined;
}
