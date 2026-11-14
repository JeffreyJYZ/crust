/**
 * The example copy this proof builds, and the constants the build needs.
 *
 * The example is copied to a scratch tree rather than built in place: it has no
 * `node_modules` (an install there would rewrite the checkout's own state), and
 * its `crust` dependency is a `github:` pin — building it would embed the
 * published framework instead of the checkout under test. The copy rewrites
 * exactly that one dependency to `file:<repo>`, so the app code is byte-identical
 * to the example and the framework is this working tree.
 */
import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "../..");
export const EXAMPLE_DIR = join(REPO_ROOT, "examples/dogear");
export const CLI = join(REPO_ROOT, "src/cli/index.ts");

/** `app.name` in the example's config, and the executable `crust build` pins. */
export const APP_NAME = "Dogear";
export const BINARY_NAME = "crust-app";

/** WebKit's web process, the shim compile and a 1.5 s pending-sheet wait. */
export const APP_TIMEOUT_MS = 45_000;

/** The example's source, minus what an install or a build owns. */
const SKIP = new Set(["node_modules", "dist", "bun.lock", ".DS_Store"]);

/**
 * Copy the example into `scratch` and point its framework dependency here.
 *
 * Only the `crust` line changes. Everything the app asserts — the fs calls, the
 * title strings, the tray labels, the panel — is the example's own code.
 */
export async function sandbox(scratch: string): Promise<void> {
	for (const name of await readdir(EXAMPLE_DIR)) {
		if (SKIP.has(name)) continue;
		await cp(join(EXAMPLE_DIR, name), join(scratch, name), { recursive: true });
	}
	const manifestPath = join(scratch, "package.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
		dependencies?: Record<string, string>;
	};
	manifest.dependencies = { ...manifest.dependencies, crust: `file:${REPO_ROOT}` };
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");
}
