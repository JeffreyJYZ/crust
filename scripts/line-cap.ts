#!/usr/bin/env bun
/**
 * The 200-line cap as a check rather than a habit: no file past 200 lines, tests and examples included, because a file you cannot read in one screen is a file whose responsibilities have merged.
 * `bun run check:lines` reads the tree and fails on every offender; `--fix` is a no-op, since the split is a human decision.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const CAP = 200;
const ROOTS = ["src", "scripts", "examples", "site"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".c", ".css", ".mjs", ".mdx"]);

/** Directories that are generated, vendored or not ours to read. */
const SKIP = new Set(["node_modules", "dist", "web", "target", ".git", "build", ".next"]);

interface Offender {
	path: string;
	lines: number;
}

async function walk(dir: string, found: Offender[]): Promise<void> {
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return;
	}
	for (const entry of entries) {
		if (SKIP.has(entry)) continue;
		const path = join(dir, entry);
		const info = await stat(path);
		if (info.isDirectory()) {
			await walk(path, found);
			continue;
		}
		const dot = entry.lastIndexOf(".");
		if (dot < 0 || !EXTENSIONS.has(entry.slice(dot))) continue;
		// Count lines the way an editor does: a trailing newline is not a line.
		const text = await readFile(path, "utf8");
		const lines = text.length === 0 ? 0 : text.replace(/\n$/, "").split("\n").length;
		if (lines > CAP) found.push({ path, lines });
	}
}

async function main(): Promise<number> {
	const found: Offender[] = [];
	for (const root of ROOTS) await walk(root, found);
	found.sort((a, b) => b.lines - a.lines);

	if (found.length === 0) {
		console.log(`check:lines  PASS  no file exceeds ${CAP} lines under ${ROOTS.join(", ")}`);
		return 0;
	}

	console.log(`check:lines  FAIL  ${found.length} file(s) exceed ${CAP} lines`);
	for (const { path, lines } of found) {
		console.log(`  ${String(lines).padStart(5)}  ${relative(process.cwd(), path)}`);
	}
	console.log(
		"\nSplit by responsibility; do not trim the comments that record a measured reason.",
	);
	return 1;
}

process.exit(await main());
