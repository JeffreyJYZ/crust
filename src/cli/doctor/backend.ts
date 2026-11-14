/**
 * The backend entry, the single-file page, and the bundle that page produces:
 * the three things a launch needs once the environment is settled.
 */

import { join, relative, resolve } from "node:path";
import { buildPage, type SingleApp } from "@/single";
import { type CliOptions, resolveBackendEntry } from "../util.ts";
import { type Check, inline } from "./check.ts";

export interface BackendCheck {
	check: Check;
	/** The entry path, absent in single-file mode: the page is the entry. */
	entryPath?: string;
}

/**
 * Backend entry: `src/main.ts` or `main.ts`, the same rule the CLI uses. A
 * single file is its own entry, since that mode has no backend module.
 */
export async function checkBackend(
	options: CliOptions,
	single: SingleApp | undefined,
): Promise<BackendCheck> {
	const entry = single ? undefined : await resolveBackendEntry(options.dir, options.entry);
	if (single) {
		return {
			check: {
				name: "backend",
				status: "ok",
				detail: `${relative(resolve(options.dir), single.file)} (the page is the entry — no backend module)`,
			},
		};
	}
	if (entry)
		return {
			check: { name: "backend", status: "ok", detail: entry.path },
			entryPath: entry.path,
		};
	return {
		check: {
			name: "backend",
			status: "fail",
			detail:
				resolve(options.dir, options.entry ?? "src/main.ts") +
				" does not exist — expected src/main.ts or main.ts",
		},
	};
}

/**
 * The page bundle a single file produces, built the way `crust dev` builds it:
 * this mode takes no config, so bundling is the only thing that can fail.
 */
export async function checkSingle(dir: string, single: SingleApp): Promise<Check> {
	try {
		const page = await buildPage(single, { dev: true });
		return {
			name: "single",
			status: "ok",
			detail: `${relative(resolve(dir), single.file)} bundles to ${relative(resolve(dir), join(page.dir, "index.html"))} (the same build crust dev runs)`,
		};
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		return {
			name: "single",
			status: "fail",
			detail:
				`${relative(resolve(dir), single.file)} does not bundle — ${inline(text)}; ` +
				"crust dev would stop here with the same error",
		};
	}
}
