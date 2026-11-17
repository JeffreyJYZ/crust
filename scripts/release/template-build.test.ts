/**
 * A scaffolded React app must build its frontend exactly once. `crust build`
 * already runs `beforeBuildCommand` — the same Vite build — so the template's
 * `build` script must not invoke Vite a second time on top of it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

interface Manifest {
	scripts: Record<string, string>;
}

function manifest(path: string): Manifest {
	return JSON.parse(readFileSync(join(ROOT, path), "utf8")) as Manifest;
}

describe("templates/react build script", () => {
	test("build delegates to crust build and leaves Vite to beforeBuildCommand", () => {
		const { scripts } = manifest("templates/react/package.json");
		expect(scripts.build).toBe("crust build");
		expect(scripts.build).not.toContain("vite");
		// The single frontend build is the one crust runs for us.
		const config = readFileSync(join(ROOT, "templates/react/crust.config.ts"), "utf8");
		expect(config).toContain("beforeBuildCommand");
		expect(config).toContain("vite build");
		// An explicit frontend-only escape hatch stays available.
		expect(scripts.frontend).toContain("vite build");
	});
});
