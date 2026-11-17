/**
 * The answer `app.info()` gives, the backend half of Butter's `getInfo`. Kept
 * apart from `app.ts` so the class stays the lifecycle; every value here is
 * read from the loaded config and this process, never guessed from a bundle.
 */

import type { CrustConfig } from "@/config";

export interface AppInfo {
	id: string;
	name: string;
	version: string;
	execPath: string;
	/** True unless the executable is a `bun`/`node`/`deno` interpreter running source. */
	packaged: boolean;
}

export function appInfo(config: CrustConfig | undefined, execPath = process.execPath): AppInfo {
	const base =
		execPath
			.split(/[\\/]/)
			.pop()
			?.replace(/\.exe$/i, "") ?? "";
	const interpreter = base === "bun" || base === "node" || base === "deno";
	return {
		id: config?.app.id ?? "",
		name: config?.app.name ?? "",
		version: config?.app.version ?? "",
		execPath,
		packaged: !interpreter,
	};
}
