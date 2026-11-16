/**
 * Discovery of a project's `native/` sources. Walks the tree, classifies each file by extension and skips
 * build output — a `target/` or `zig-cache/` inside `native/` holds compiled copies, and listing those as
 * sources would compile the same code twice under two names.
 */

import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { KIND } from "./extension-tools";

export type ExtensionsFound = { zig: string[]; rust: string[]; c: string[] };

/** The `native/` directory. Defaults to `native`; a project root works too, see `discoverExtensions`. */
export type DiscoverExtensionsOptions = { dir?: string };

/** Build output and vendored trees inside `native/` are not sources. */
const SKIP = new Set(["node_modules", ".git", "target", "zig-cache", "zig-out", ".zig-cache"]);

async function walk(dir: string, found: ExtensionsFound): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (SKIP.has(entry.name)) continue;
			await walk(path, found);
			continue;
		}
		const kind = KIND[extname(entry.name)];
		if (kind) found[kind].push(path);
	}
}

/** Every `.zig`, `.rs` and `.c` under `dir`, absolute and sorted per toolchain. */
export async function discoverExtensions(
	options: DiscoverExtensionsOptions = {},
): Promise<ExtensionsFound> {
	const root = resolve(options.dir ?? "native");
	const found: ExtensionsFound = { zig: [], rust: [], c: [] };
	await walk(root, found);
	// A project root is a fair argument too, since `native/` is where the sources live.
	if (found.zig.length + found.rust.length + found.c.length === 0) {
		const nested = join(root, "native");
		if (nested !== root) await walk(nested, found);
	}
	for (const list of [found.zig, found.rust, found.c]) list.sort();
	return found;
}
