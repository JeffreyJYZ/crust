/**
 * Scan the project's own source for the traps `site/app/docs/design/page.mdx` records as fatal.
 * Each is named when it is hit, with the line that hit it: a user who copied a
 * snippet that passed a JS string into C needs to see why the process died with
 * no JavaScript error, not a generic "window did not open".
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Check } from "./check.ts";

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
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git", ".crust", ".cache", ".turbo"]);
const MAX_SCANNED_BYTES = 512 * 1024;

export async function projectSources(dir: string, prefix = ""): Promise<string[]> {
	const entries = await readdir(join(dir, prefix), { withFileTypes: true }).catch(() => []);
	const files: string[] = [];
	for (const entry of entries) {
		const relative = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
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

export async function scanTraps(dir: string): Promise<Check[]> {
	const checks: Check[] = [];
	const files = await projectSources(dir);

	for (const relative of files) {
		const path = join(dir, relative);
		const info = await Bun.file(path)
			.stat()
			.catch(() => undefined);
		if (!info?.isFile() || info.size > MAX_SCANNED_BYTES) continue;
		const text = await Bun.file(path)
			.text()
			.catch(() => "");
		if (text.includes("\u0000")) continue;
		const lines = text.split("\n");

		const allocInit = lines.findIndex(
			(source) =>
				/\[\s*[A-Za-z_]\w*\s+alloc\s*\]\s*init\b/.test(source) ||
				(/\balloc\b/.test(source) &&
					/\binit\b/.test(source) &&
					/sel_registerName|objc_msgSend/.test(source)),
		);
		if (allocInit !== -1) {
			checks.push({
				name: "trap",
				status: "fail",
				detail:
					`${relative}:${allocInit + 1} sends init to an allocated NSWindow — ` +
					"[[NSWindow alloc] init] aborts the process from AppKit's own thread; " +
					"build the rect in C and call initWithContentRect: instead",
			});
		}

		const stringSend = lines.findIndex(
			(source) =>
				/\bstringWithUTF8String\s*:/.test(source) ||
				(/\bNSString\b/.test(source) && /\bcstring\b|\bptr\(/.test(source)),
		);
		if (stringSend !== -1) {
			checks.push({
				name: "trap",
				status: "fail",
				detail:
					`${relative}:${stringSend + 1} builds or passes a short ASCII NSString — ` +
					"it is a tagged pointer and cannot cross bun:ffi; keep the string in C " +
					"behind a handle",
			});
		}

		if (text.includes("FFIType.cstring")) {
			const literalCall = lines.findIndex(
				(source) =>
					/\.\w+\(\s*(["'])[^"'`\n]*\1\s*\)/.test(source) &&
					!/TextEncoder|new Uint8Array|Buffer\.from/.test(source),
			);
			if (literalCall !== -1) {
				checks.push({
					name: "trap",
					status: "note",
					detail:
						`${relative}:${literalCall + 1} may pass a JavaScript string where the ` +
						"shim expects const char * — a JS string cannot cross into compiled C; " +
						"pass ptr(new TextEncoder().encode(value))",
				});
			}
		}
	}

	return checks;
}
