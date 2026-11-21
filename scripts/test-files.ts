/**
 * The single source of truth for which test files `bun run test` runs.
 * A hand-written list rots: probe.test.ts and guard.test.ts went unrun for a whole
 * round because nobody remembered to add them. Discovery from the tree cannot rot.
 */
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export const REPO_ROOT = join(import.meta.dir, "..");

/**
 * Trees that ship tests. `docs/` holds one-off review probes that are expected to
 * fail, and `research/` is a vendored checkout whose watchdog test is not ours;
 * neither belongs in the suite.
 */
export const TEST_ROOTS = ["src", "examples", "scripts"] as const;

const SKIP = new Set(["node_modules", "dist", ".next", "web", "target", ".git"]);

/** Every `*.test.ts` under the shipped roots, as repo-relative paths with `/` separators. */
export async function discoverTests(root = REPO_ROOT): Promise<string[]> {
	const found: string[] = [];
	async function walk(dir: string): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			if (SKIP.has(entry.name)) continue;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) await walk(path);
			else if (entry.name.endsWith(".test.ts"))
				found.push(relative(root, path).split(sep).join("/"));
		}
	}
	for (const tree of TEST_ROOTS) await walk(join(root, tree));
	return found.sort();
}
