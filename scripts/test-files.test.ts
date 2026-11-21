/**
 * `bun run test` must cover every shipped test file. Discovery, not a list, is the
 * mechanism: two harness suites went unrun for a whole round because nobody added
 * them to package.json.
 */
import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { discoverTests, REPO_ROOT, TEST_ROOTS } from "./test-files.ts";

/** A walk independent of discoverTests, so a shared bug cannot hide the omission. */
async function independent(dir: string): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await independent(path)));
		else if (entry.name.endsWith(".test.ts"))
			out.push(relative(REPO_ROOT, path).split(sep).join("/"));
	}
	return out;
}

describe("test discovery", () => {
	test("the suite delegates to discovery, not a hand-written file list", async () => {
		const pkg = JSON.parse(await Bun.file(join(REPO_ROOT, "package.json")).text());
		expect(pkg.scripts.test).toContain("scripts/test-all.ts");
	});

	test("every *.test.ts under the shipped roots is discovered", async () => {
		const expected = (
			await Promise.all(TEST_ROOTS.map((root) => independent(join(REPO_ROOT, root))))
		).flat();
		const found = new Set(await discoverTests());
		expect(expected.length).toBeGreaterThan(0);
		expect(expected.filter((file) => !found.has(file))).toEqual([]);
	});

	test("the two suites skipped for a round are discovered", async () => {
		const found = await discoverTests();
		expect(found).toContain("scripts/harness/probe.test.ts");
		expect(found).toContain("scripts/harness/guard.test.ts");
	});
});
