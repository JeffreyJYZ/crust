import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	frontmatterProblems,
	MAX_DESCRIPTION,
	NAME_PATTERN,
} from "./frontmatter.ts";

const block = (name: string, description: string): string =>
	`---\nname: ${name}\ndescription: ${description}\n---\n\n# Body\n`;

describe("skill frontmatter", () => {
	test("present and well shaped passes", () => {
		expect(
			frontmatterProblems(block("crust", "a desktop app from Bun")),
		).toEqual([]);
	});

	test("missing frontmatter fails, naming the block", () => {
		const problems = frontmatterProblems("# Building with crust\n\ntext\n");
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("no YAML frontmatter");
	});

	test("frontmatter after a heading fails: it must be the first bytes", () => {
		const problems = frontmatterProblems(
			`# Heading\n\n${block("crust", "d")}`,
		);
		expect(problems[0]).toContain("no YAML frontmatter");
	});

	test("missing name or description fails", () => {
		expect(
			frontmatterProblems("---\nname: crust\n---\n\nbody\n").join(),
		).toContain("`description`");
		expect(
			frontmatterProblems("---\ndescription: d\n---\n\nbody\n").join(),
		).toContain("`name`");
	});

	test("wrong name shape fails", () => {
		for (const name of ["Crust", "my crust", "crust!", "-crust", ""]) {
			expect(NAME_PATTERN.test(name)).toBe(false);
			expect(frontmatterProblems(block(name, "d")).join()).toContain(
				"`name`",
			);
		}
	});

	test("a hyphenated lowercase name passes", () => {
		expect(frontmatterProblems(block("crust-app", "d"))).toEqual([]);
	});

	test("a description over the cap fails", () => {
		const problems = frontmatterProblems(
			block("crust", "x".repeat(MAX_DESCRIPTION + 1)),
		);
		expect(problems.join()).toContain("over");
	});

	test("quoted scalars are read as their value", () => {
		expect(
			frontmatterProblems('---\nname: "crust"\ndescription: "d"\n---\n'),
		).toEqual([]);
	});

	test("the committed SKILL.md installs", async () => {
		const path = join(
			import.meta.dir,
			"..",
			"..",
			"site",
			"public",
			"SKILL.md",
		);
		expect(frontmatterProblems(await Bun.file(path).text())).toEqual([]);
	});
});
