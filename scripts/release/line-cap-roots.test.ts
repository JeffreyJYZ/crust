/**
 * The 200-line cap is only a gate if its walk covers every tree that ships.
 * Templates ship with the package, so a template that grows past the cap must
 * fail `check:lines` just like a source file does.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

describe("check:lines roots", () => {
	test("the line-cap walk includes templates", () => {
		const script = readFileSync(join(ROOT, "scripts/line-cap.ts"), "utf8");
		const match = script.match(/const ROOTS = \[([^\]]*)\]/);
		expect(match).not.toBeNull();
		const roots = (match?.[1] ?? "")
			.split(",")
			.map((part) => part.trim().replace(/^"|"$/g, ""));
		for (const root of ["src", "scripts", "examples", "site", "templates"]) {
			expect(roots).toContain(root);
		}
	});

	test("a bare build name does not prune the shipped src/cli/build tree", () => {
		// src/cli/build holds real source and tests; a 250-line file there must fail the cap.
		const script = readFileSync(join(ROOT, "scripts/line-cap.ts"), "utf8");
		const skip = script.match(/const SKIP = new Set\(\[([^\]]*)\]\)/);
		expect(skip).not.toBeNull();
		expect(skip?.[1]).not.toContain('"build"');
		expect(skip?.[1]).toContain('"node_modules"');
	});
});
