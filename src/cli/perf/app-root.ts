/** Resolve `--app` to a web root the bridge can serve. A path that is not an app is refused. */

import { stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const isFile = async (path: string): Promise<boolean> =>
	stat(path)
		.then((entry) => entry.isFile())
		.catch(() => false);

const hasIndex = (dir: string): Promise<boolean> => isFile(join(dir, "index.html"));

/**
 * A directory with `index.html` is a web root; a project with `public/` or a built `.app` bundle
 * with `Contents/Resources/public` resolves to the served root. An executable alone carries no
 * bridge handle this recorder can pull from, so it is not an app for this command.
 */
export async function appRoot(input: string): Promise<string | undefined> {
	if (typeof input !== "string" || input.length === 0) return undefined;
	const path = resolve(input);
	if (await isFile(path)) {
		return basename(path) === "index.html" ? dirname(path) : undefined;
	}
	const entry = await stat(path).catch(() => undefined);
	if (entry === undefined || !entry.isDirectory()) return undefined;
	for (const candidate of [
		path,
		join(path, "public"),
		join(path, "Contents", "Resources", "public"),
		join(path, "Contents", "Resources"),
	]) {
		if (await hasIndex(candidate)) return candidate;
	}
	return undefined;
}
