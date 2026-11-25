/**
 * `bun pm pack` ships only `src`, `templates` and `docs`. A specifier that climbs out of `src`
 * resolves in this checkout and dies in the installed package — the 0.2.14 failure where
 * `src/cli/perf` imported `scripts/` and `crust --help` could not load. Scan the shipped surface:
 * every TypeScript file under src except `.test.ts`, which the manifest excludes. Tests may use
 * the harness; shipped modules may not.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { describe, expect, test } from "bun:test";

const REPO = resolve(import.meta.dir, "..", "..", "..");
const SRC = join(REPO, "src");

/** Static `from`, bare `import`, dynamic `import()` and `require()` literals. */
const SPECIFIER = /(?:from|import|require)\s*\(?\s*(["'])([^"']+)\1/g;
const PATH_SPECIFIER = /^\.{1,2}(?:[/\\]|$)|^\/|^[A-Za-z]:[\\/]/;
/** npm always includes the manifest beside the tarball's `src/`, so that one climb is safe. */
const MANIFEST = join(REPO, "package.json");

function shippedFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) found.push(...shippedFiles(path));
		else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
			found.push(path);
		}
	}
	return found;
}

function inside(path: string, root: string): boolean {
	const rel = relative(root, path);
	return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}

function outsideImports(): string[] {
	const violations: string[] = [];
	for (const file of shippedFiles(SRC)) {
		const source = readFileSync(file, "utf8");
		for (const match of source.matchAll(SPECIFIER)) {
			const spec = match[2] ?? "";
			if (!PATH_SPECIFIER.test(spec)) continue;
			const target = spec.startsWith(".") ? resolve(dirname(file), spec) : resolve(spec);
			if (inside(target, SRC) || target === MANIFEST) continue;
			const line = source.slice(0, match.index).split("\n").length;
			violations.push(`${relative(REPO, file)}:${line} ${spec}`);
		}
	}
	return violations;
}

describe("shipped src surface", () => {
	test("no shipped module imports a path outside src", () => {
		expect(shippedFiles(SRC).length).toBeGreaterThan(0);
		const violations = outsideImports();
		if (violations.length > 0) console.log(`outside-src imports: ${violations.join(", ")}`);
		expect(violations).toEqual([]);
	});
});
