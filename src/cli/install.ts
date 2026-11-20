/**
 * Why `bun install` has not been run in a project, when that is the state. Split from `util.ts` when
 * the CLI passed the line cap, and kept beside the commands that refuse on it.
 */

import { join, resolve } from "node:path";
import { exists } from "./util.ts";

/**
 * A declared dependency set with no `node_modules` is what a fresh clone or a `rm -rf` leaves; the
 * frontend command then cannot find its tool locally, and `bun x` silently resolves one from the
 * global cache — vite starts, dies on the missing react, and the user gets a rolldown stack with
 * crust reporting "the frontend build failed", which points at the wrong thing entirely.
 */
export async function missingInstall(dir: string): Promise<string | undefined> {
	const manifest = Bun.file(join(dir, "package.json"));
	if (!(await manifest.exists())) return undefined;

	let declared = 0;
	try {
		const parsed = (await manifest.json()) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		declared =
			Object.keys(parsed.dependencies ?? {}).length +
			Object.keys(parsed.devDependencies ?? {}).length;
	} catch {
		return undefined;
	}
	if (declared === 0) return undefined;
	if (await exists(join(dir, "node_modules"), "dir")) return undefined;
	return (
		`node_modules is missing in ${resolve(dir)} — run \`bun install\` first. ` +
		"Without it the frontend command resolves its tool from a global cache and fails " +
		"on the packages it cannot find"
	);
}
