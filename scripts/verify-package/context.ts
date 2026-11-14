/**
 * The received package as the phases read it: which files travelled, and one
 * assertion at a time.
 */
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export const ROOT = ((): string => {
	// A positional path lets the same checks run against a tag or a release
	// tarball's source, which is the only way "passes at 0.1.8" is a fact rather
	// than a claim about whatever the working tree happened to hold.
	const candidate = process.argv[2];
	if (candidate !== undefined && !candidate.startsWith("-")) return resolve(candidate);
	return resolve(import.meta.dir, "../..");
})();

/** One reason the received package is not what the checkout promises. */
export interface Gap {
	what: string;
	detail: string;
}

/**
 * Record and report one assertion, in the order a user would meet it.
 *
 * `gap` is what a failure means; it is printed only when the check fails, so
 * a passing line never reads as a complaint. `found` is the passing detail,
 * where a count or a path is the evidence.
 */
export type Check = (what: string, ok: boolean, gap?: string, found?: string) => void;

/** Everything a phase may read about the package that travelled. */
export interface Stage {
	check: Check;
	pkgRoot: string;
	listing: Set<string>;
	shipped(path: string): boolean;
	manifest: Record<string, unknown>;
	checkout: Record<string, unknown>;
}

/** Every file under `dir`, as `/`-separated relative paths. */
export async function filesUnder(dir: string, prefix = ""): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	const files: string[] = [];
	for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
		const path = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			files.push(...(await filesUnder(join(dir, entry.name), path)));
		} else if (entry.isFile()) {
			files.push(path);
		}
	}
	return files;
}

/** `@/x` style specifiers only resolve while the checkout's tsconfig is present. */
export function usesAlias(source: string): boolean {
	return /\bfrom\s+"@\/|\bfrom\s+'@\//.test(source) || /\bimport\s*\(\s*["']@\//.test(source);
}
