/**
 * `crust/perf/overlay` is the supported way for an app page to mount the developer overlay. Three
 * proofs: the package maps the subpath, the module exports the real API without reaching into
 * plugins or the bridge (it is page code), and a production build that mounts no overlay entry
 * emits zero occurrences of the module's marker.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const REPO = resolve(import.meta.dir, "..", "..", "..");
const SUBPATH = "./perf/overlay";
const TARGET = "./src/perf/overlay/overlay.ts";
const MARKER = "crust-perf-overlay/v1";

describe("crust/perf/overlay", () => {
	test("the package maps the subpath and it exports the overlay API", async () => {
		const manifest = JSON.parse(await Bun.file(join(REPO, "package.json")).text()) as {
			exports: Record<string, string>;
		};
		expect(manifest.exports[SUBPATH]).toBe(TARGET);
		expect(existsSync(join(REPO, TARGET))).toBe(true);

		const mod = await import("crust/perf/overlay");
		expect(typeof mod.mountOverlay).toBe("function");
		expect(mod.MARKER).toBe(MARKER);
	});

	test("the overlay stays page code: no plugin or bridge imports", () => {
		const dir = join(REPO, "src", "perf", "overlay");
		const files = readdirSync(dir).filter(
			(name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
		);
		expect(files.length).toBeGreaterThan(0);
		const forbidden = /(?:src\/)?(?:plugins|bridge)\//;
		for (const file of files) {
			const source = readFileSync(join(dir, file), "utf8");
			expect(forbidden.test(source)).toBe(false);
			expect(source).not.toContain("crust/plugin");
		}
	});

	test("a production build with no overlay entry contains zero markers", async () => {
		const { buildProduction } = await import("../../../examples/perf-overlay/build.ts");
		const dir = mkdtempSync(join(tmpdir(), "crust-overlay-export-prod-"));
		try {
			const files = await buildProduction(dir);
			let bytes = "";
			for (const file of files) bytes += readFileSync(file, "utf8");
			expect(bytes.length).toBeGreaterThan(0);
			const count = bytes.split(MARKER).length - 1;
			console.log(`production overlay markers: ${count} in ${files.length} file(s)`);
			expect(count).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
