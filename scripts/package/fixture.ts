/**
 * The packaging proof's fixture: what it copies, the bundle and image names the
 * example's manifest decides, and the cheap "did this change" helpers.
 */
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "../..");
// CRUST_BIN lets the same suite judge a *shipped* crust — an installed tarball or a
// compiled binary — rather than this checkout. Default is the checkout.
export const CLI = process.env.CRUST_BIN ?? join(REPO_ROOT, "src/cli/index.ts");
export const EXAMPLE_DIR = join(REPO_ROOT, "examples/hello");

/** `CFBundleExecutable` that `crust build` pins. Same constant as `e2e.ts`. */
export const BINARY_NAME = "crust-app";

/**
 * The example imports `crust`, which resolves through this package's own exports
 * map inside the checkout. A scratch copy has no install, so one symlink to the
 * checkout stands in for it — and it is also what `projectCrustRoot` realpaths, so
 * the compiled binary carries exactly one copy of the framework.
 */
export const FALLBACK_DEPENDENCY = REPO_ROOT;

/** A stub image is the failure this refuses: the app alone is ~85 MiB. */
export const MIN_DMG_BYTES = 10 * 1024 * 1024;

/** The example's own manifest: the bundle and image names come from here. */
export interface ExampleConfig {
	app: { name: string; version: string };
}

/** One detail line, so the captured refusal is visible verbatim in the log. */
export function note(text: string): void {
	console.log(`  note  ${text}`);
}

/** The bundle's binary, as a digest — the cheapest "did this change" proof. */
export async function sha256(path: string): Promise<string> {
	const bytes = await Bun.file(path)
		.arrayBuffer()
		.catch(() => undefined);
	if (bytes === undefined) return "missing";
	return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
}

/** Every `.dmg` in `dir`, sorted — the set a second run must not grow. */
export async function listDmgs(dir: string): Promise<string[]> {
	const entries = await readdir(dir).catch(() => [] as string[]);
	return entries.filter((name) => name.endsWith(".dmg")).sort();
}

/** Top-level names in `dist`, for "did the command touch anything" checks. */
export async function listDist(dir: string): Promise<string[] | undefined> {
	try {
		return (await readdir(dir)).sort();
	} catch {
		return undefined;
	}
}
