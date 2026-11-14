/**
 * What `build.assets` resolved to: the files to embed, or the sentence that
 * stops the build. A failed `beforeBuildCommand` and an empty frontend
 * directory are both failures here, never a package made from stale bytes.
 */

import { join, resolve } from "node:path";
import type { CrustConfig } from "@/config";
import { exists, line, runShell } from "../util.ts";
import { type AssetFile, collectAssets } from "./assets.ts";

export type ResolvedAssets =
	{ ok: true; files: AssetFile[]; label: string } | { ok: false; failure: string };

/** The `run its build` half shared by the two "nothing to embed" failures. */
const FRONTEND_HINT =
	"run its build (for Vite, `bun --bun ./node_modules/.bin/vite build`) then `crust build`";

/**
 * Run `build.beforeBuildCommand` (if any), then read `build.assets`. The command runs first and its non-zero exit aborts, so a framework app never ships whatever sat in its asset directory from an earlier run; stdio is inherited, so the frontend's own output is the user's to read. The directory is read and checked only after it returns — "exited 0" is not the same fact as "produced an index.html". Returns rather than throws so `build` prints one line in its own format.
 */
export async function resolveAssets(
	dir: string,
	config: CrustConfig,
	outDir: string,
): Promise<ResolvedAssets> {
	const command = config.build?.beforeBuildCommand;
	if (command) {
		line("before", command);
		const code = await runShell(command, dir);
		if (code !== 0) {
			return {
				ok: false,
				failure:
					`build.beforeBuildCommand \`${command}\` exited with ${code} — ` +
					"the frontend build failed, so nothing was packaged",
			};
		}
	}
	const built = command !== undefined;

	const setting = config.build?.assets;
	const assetsDir = resolve(dir, setting ?? "public");
	const label = setting ?? "public";

	// Only a *named* directory is a promise crust can hold you to. Absent, the
	// old behaviour stands: `public/` is embedded if it exists, and a project
	// with no frontend directory still builds.
	if (setting) {
		// `dist` is also where this command writes, so a second build would walk
		// its own binary and embed it. Refuse before that can happen.
		if (assetsDir === outDir) {
			return {
				ok: false,
				failure:
					`build.assets "${setting}" is ${outDir}, where crust build writes its own ` +
					"output — point it at the frontend's directory (for Vite, dist/web) so a " +
					"second build cannot embed its own binary",
			};
		}
		if (!(await exists(assetsDir, "dir"))) {
			return {
				ok: false,
				failure:
					`build.assets "${setting}" is not a directory (resolved to ${assetsDir}) — ` +
					(built
						? "the frontend build produced nothing there, so nothing was packaged"
						: `the frontend has not been built yet; ${FRONTEND_HINT}`),
			};
		}
		if (!(await exists(join(assetsDir, "index.html")))) {
			return {
				ok: false,
				failure:
					`build.assets "${setting}" holds no index.html (looked in ${assetsDir}) — ` +
					(built
						? "the frontend build produced nothing there, so nothing was packaged"
						: `the frontend has not been built yet; ${FRONTEND_HINT}`),
			};
		}
	}

	return { ok: true, files: await collectAssets(assetsDir), label };
}
