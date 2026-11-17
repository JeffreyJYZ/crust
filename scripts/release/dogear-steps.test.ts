/**
 * The dogear self-check prints eleven numbered results: nine from steps.tsx and
 * two from panels.tsx. A comment that calls the panels "steps 9–10" documents
 * a sequence that cannot happen, so pin the labels to the actual check count.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function source(path: string): string {
	return readFileSync(join(ROOT, path), "utf8");
}

describe("dogear self-check step numbering", () => {
	test("panels are steps 10 and 11, after the nine checks in steps.tsx", () => {
		const steps = source("examples/dogear/src/selfcheck/steps.tsx");
		const panels = source("examples/dogear/src/selfcheck/panels.tsx");
		expect(steps.match(/await check\(/g) ?? []).toHaveLength(9);
		expect(panels).toContain("Steps 10–11");
		expect(panels).toContain("// 10. The folder picker");
		expect(panels).toContain("// 11. The page's own cancel");
		expect(panels).not.toContain("step 9");
		expect(panels).not.toContain("9–10");
	});
});
