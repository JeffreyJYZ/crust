/**
 * Which files the doctor's source checks read: the app's own source, and
 * nothing else. `node_modules`, build output and a nested checkout are not the
 * app's code, so a trap inside one is not the app's to fix. Walking the whole
 * working directory is what made `crust doctor` report the framework's own shim
 * as 39 broken checks when it was run from the framework repo.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

const SOURCE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".c",
	".m",
]);

/** Output, caches and dependency trees: never the app's own source. */
const SKIPPED_DIRECTORIES = new Set([
	"node_modules",
	"dist",
	"build",
	"target",
	".git",
	".crust",
	".cache",
	".turbo",
	".next",
	"coverage",
]);

const QUOTES = new Set(['"', "'", "`"]);

/** A nested `package.json` means a separate project: a monorepo package, or a sibling checkout sitting inside this one. */
async function nestedProject(dir: string): Promise<boolean> {
	return await Bun.file(join(dir, "package.json")).exists();
}

export async function projectSources(dir: string, prefix = ""): Promise<string[]> {
	const entries = await readdir(join(dir, prefix), { withFileTypes: true }).catch(() => []);
	const files: string[] = [];
	for (const entry of entries) {
		const relative = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
			if (await nestedProject(join(dir, relative))) continue;
			files.push(...(await projectSources(dir, relative)));
			continue;
		}
		if (!entry.isFile()) continue;
		const dot = entry.name.lastIndexOf(".");
		if (dot === -1) continue;
		if (SOURCE_EXTENSIONS.has(entry.name.slice(dot).toLowerCase())) files.push(relative);
	}
	return files;
}

/**
 * Drop `//` and block comments, keeping every newline so a reported line number
 * still matches the file. Every trap pattern is a short phrase that prose about
 * the trap also contains — `10_prelude.c` states the NSString rule in its own
 * header — so matching raw text reports the documentation that warns about the
 * bug as the bug. A quoted `//` (a URL, a path) stays, because the quote opens
 * before the comment check runs.
 */
export function stripComments(text: string): string {
	let out = "";
	let index = 0;
	let quote: string | undefined;
	let block = false;
	while (index < text.length) {
		const char = text[index] as string;
		const next = text[index + 1];
		if (block) {
			if (char === "*" && next === "/") {
				block = false;
				index += 2;
				continue;
			}
			if (char === "\n") out += char;
			index += 1;
			continue;
		}
		if (quote !== undefined) {
			out += char;
			if (char === "\\") {
				out += next ?? "";
				index += 2;
				continue;
			}
			if (char === quote) quote = undefined;
			index += 1;
			continue;
		}
		if (QUOTES.has(char)) {
			quote = char;
			out += char;
			index += 1;
			continue;
		}
		if (char === "/" && next === "/") {
			const end = text.indexOf("\n", index);
			index = end === -1 ? text.length : end;
			continue;
		}
		if (char === "/" && next === "*") {
			block = true;
			index += 2;
			continue;
		}
		out += char;
		index += 1;
	}
	return out;
}
