/**
 * The Windows installer proof's fixture: the argv that runs this checkout's CLI, the
 * names the example's manifest decides, and the floors a stub artefact cannot reach.
 * Kept apart from the dmg fixture because the two share nothing but a repository.
 */
import { join, resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "../..");
export const EXAMPLE_DIR = join(REPO_ROOT, "examples/hello");

/**
 * `bun <file>`, never `<file>`: Windows has no shebang, so a spawn of `index.ts`
 * asks CreateProcess to execute a text file and fails before the CLI runs.
 */
export const CLI = [process.execPath, join(REPO_ROOT, "src/cli/index.ts")];

/** `crust build` compiles `crust-app`, and Bun appends `.exe` on Windows. */
export const BINARY_NAME = "crust-app.exe";

/** The compiled binary alone is ~85 MiB, and the installer carries it; a stub is KiB. */
export const MIN_INSTALLER_BYTES = 10 * 1024 * 1024;
export const MIN_BINARY_BYTES = 10 * 1024 * 1024;

/** Everything the later phases address, once the example is built. */
export interface Built {
	name: string;
	dist: string;
	binary: string;
	installer: string;
	script: string;
}

/** The example's own manifest: the artefact names come from here. */
export interface ExampleConfig {
	app: { id: string; name: string; version: string };
}

/** The first two bytes of a PE image, read rather than inferred from a suffix. */
export async function isPortableExecutable(path: string): Promise<boolean> {
	const bytes = await Bun.file(path)
		.slice(0, 2)
		.arrayBuffer()
		.catch(() => undefined);
	if (bytes === undefined) return false;
	const [m, z] = new Uint8Array(bytes);
	return m === 0x4d && z === 0x5a;
}
