/**
 * `startApp`'s host questions: which port to bind, which document to serve, and
 * which entry module to import.
 *
 * None of it needs the app instance, so it lives beside `runtime.ts` rather than
 * inside it.
 */

import { join, resolve } from "node:path";
import type { AssetTable } from "@/bridge/server.ts";

/** The origin a dev server serves from, or undefined when the URL is unusable. */
export function originOf(url: string): string | undefined {
	try {
		return new URL(url).origin;
	} catch {
		return undefined;
	}
}

/**
 * A stable port for an app, derived from its id.
 *
 * The bridge used to bind `0`, which makes the page's origin change every launch
 * and discards localStorage, IndexedDB, service workers and per-origin caches.
 * Deriving from the id keeps the origin stable across runs; the caller walks
 * upward when the port is taken, and falls back to ephemeral rather than failing.
 */
export function preferredPortFor(appId: string): number {
	let hash = 2166136261;
	for (let index = 0; index < appId.length; index++) {
		hash ^= appId.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return 45000 + ((hash >>> 0) % 4000);
}

export async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await Bun.file(path).stat()).isDirectory();
	} catch {
		return false;
	}
}

/**
 * The backend entry: an explicit path must exist; otherwise `src/main.ts` then
 * `main.ts`, matching the CLI's rule so both entry points agree.
 */
export async function resolveEntry(explicit: string | undefined): Promise<string | undefined> {
	if (explicit) {
		const path = resolve(explicit);
		return (await Bun.file(path).exists()) ? path : undefined;
	}
	for (const candidate of ["src/main.ts", "main.ts"]) {
		const path = resolve(candidate);
		if (await Bun.file(path).exists()) return path;
	}
	return undefined;
}

/** The document the bridge will serve, from the binary's assets or from disk. */
export async function readIndex(
	root: string | undefined,
	assets?: AssetTable,
): Promise<string | undefined> {
	const embedded = assets?.["/index.html"];
	if (typeof embedded === "string") return embedded;
	if (!root) return undefined;
	const file = Bun.file(join(root, "index.html"));
	return (await file.exists()) ? await file.text() : undefined;
}
