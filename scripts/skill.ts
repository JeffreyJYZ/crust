#!/usr/bin/env bun
/**
 * Regenerate the command table in `site/public/SKILL.md` from the live registry.
 *
 * Only the region between the `skill:commands` markers is replaced; everything outside them is
 * prose a human owns and survives byte-for-byte — the YAML frontmatter included, which is the first
 * bytes of the file and what the `skills` CLI reads before it will install anything.
 * `--check` regenerates in memory and fails with a diff when the committed file is stale, and also
 * fails when the frontmatter is missing or malformed: a check that passes on a file the skills CLI
 * refuses is the defect, not the gate.
 */
import { join } from "node:path";
import { cac } from "cac";
import { frontmatterProblems } from "./skill/frontmatter.ts";
import { registry } from "./skill/registry.ts";
import { render } from "./skill/render.ts";

const SKILL_PATH = join(import.meta.dir, "..", "site", "public", "SKILL.md");
const BEGIN = "<!-- skill:commands:begin -->";
const END = "<!-- skill:commands:end -->";

/** Replace strictly the text between the two markers. */
function generate(file: string, table: string): string {
	const begin = file.indexOf(BEGIN);
	const end = file.indexOf(END);
	if (begin < 0 || end < 0 || end < begin) {
		throw new Error(
			"SKILL.md is missing the skill:commands begin/end markers",
		);
	}
	const before = file.slice(0, begin + BEGIN.length);
	const after = file.slice(end); // starts with END, which must stay put
	return `${before}\n${table.trimEnd()}\n${after}`;
}

/** Minimal hunk diff: shared prefix and suffix, with the changed middle shown as -/+ lines. */
function diff(a: string, b: string): string {
	const A = a.split("\n");
	const B = b.split("\n");
	let start = 0;
	while (start < A.length && start < B.length && A[start] === B[start])
		start++;
	let aEnd = A.length - 1;
	let bEnd = B.length - 1;
	while (aEnd >= start && bEnd >= start && A[aEnd] === B[bEnd]) {
		aEnd--;
		bEnd--;
	}
	const out: string[] = [];
	for (let i = Math.max(0, start - 2); i < start; i++) out.push(` ${A[i]}`);
	for (let i = start; i <= aEnd; i++) out.push(`-${A[i]}`);
	for (let i = start; i <= bEnd; i++) out.push(`+${B[i]}`);
	for (let i = aEnd + 1; i < Math.min(A.length, aEnd + 3); i++)
		out.push(` ${A[i]}`);
	return out.join("\n");
}

const cli = cac("skill");
cli.option("--check", "check the committed table without writing");
cli.help();
const { options } = cli.parse();

const table = render(await registry());
const file = await Bun.file(SKILL_PATH).text();

// The skills CLI skips the file outright when the frontmatter is wrong, so it is a gate failure
// here rather than a warning: an installable file is part of the deliverable.
const problems = frontmatterProblems(file);
if (problems.length > 0) {
	const label = options.check ? "skill:check" : "skill";
	console.error(
		`${label}  FAIL  site/public/SKILL.md frontmatter is not installable\n`,
	);
	for (const problem of problems) console.error(`  ${problem}`);
	console.error(
		"\nThe skills CLI would skip this file and report `No skills found`.",
	);
	process.exit(1);
}

const updated = generate(file, table);

if (options.check) {
	if (file === updated) {
		console.log("skill:check  PASS  SKILL.md command table is current");
		process.exit(0);
	}
	console.error("skill:check  FAIL  SKILL.md command table is stale\n");
	console.error(diff(file, updated));
	process.exit(1);
}

if (file === updated)
	console.log("skill  no change (SKILL.md already current)");
else {
	await Bun.write(SKILL_PATH, updated);
	console.log("skill  wrote site/public/SKILL.md command table");
}
