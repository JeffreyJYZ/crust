/**
 * `crust:store`'s disk half: one JSON object of `{ key: value }` at `store.json` under the app's data directory, mode 0600. Read, write and the "can JSON hold this" check live here so the atomic write and the corrupt-file rule can be read without the plugin's typed answers in the way.
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { CrustError } from "../bridge/errors";

/** The live file; one file for every key, so a read never scans a directory. */
export const STORE_FILE = "store.json";

/** Appended to the live name when the file is not a JSON object: `store.json.corrupt`. */
export const CORRUPT_SUFFIX = ".corrupt";

export type StoreEntries = Record<string, unknown>;

/**
 * Serialise read-modify-write per absolute file path. The queue is module-scoped, so two plugin
 * instances pointed at the same file share one chain — a command must re-read *inside* `run`
 * to see the previous command's commit rather than a stale in-memory snapshot.
 */
const fileQueues = new Map<string, Promise<unknown>>();

export function withFileLock<T>(file: string, run: () => Promise<T>): Promise<T> {
	const previous = fileQueues.get(file) ?? Promise.resolve();
	const next = previous.then(run, run);
	fileQueues.set(file, next);
	// Drop the entry once it settles so a long-lived app does not grow the map per write. A newer
	// chain may have replaced ours while it ran; never delete that one.
	const forget = (): void => {
		if (fileQueues.get(file) === next) fileQueues.delete(file);
	};
	void next.then(forget, forget);
	return next;
}

export interface StoreRead {
	entries: StoreEntries;
	/** Absolute path the corrupt file was moved to, present only when this read found one. */
	corrupt?: string;
}

/**
 * macOS's per-app data directory. `CRUST_DATA_DIR` wins, because a packaged app is launched with `/` as cwd and already knows its own root.
 */
export function defaultStoreRoot(app: string, home = homedir()): string {
	const override = process.env.CRUST_DATA_DIR;
	if (override !== undefined && override.length > 0) return override;
	return join(home, "Library", "Application Support", app);
}

/**
 * Every entry the file holds. A missing file is the empty store. Anything else — a truncated write, a hand-edited file, an empty file — is moved aside once so the next launch starts clean instead of re-reporting it forever; a failed rename still answers an empty store rather than throwing on a read.
 */
export async function readStore(file: string): Promise<StoreRead> {
	const text = await readFile(file, "utf8").catch(() => undefined);
	if (text === undefined) return { entries: {} };
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		parsed = undefined;
	}
	if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
		return { entries: { ...(parsed as StoreEntries) } };
	}
	const corrupt = `${file}${CORRUPT_SUFFIX}`;
	// Only claim recovery when the rename actually succeeded. A failed rename left the corrupt
	// bytes in place, so reporting `corrupt` here would lie about preserving them — and the next
	// persist would overwrite them anyway.
	const moved = await rename(file, corrupt).then(
		() => true,
		() => false,
	);
	return moved ? { entries: {}, corrupt } : { entries: {} };
}

/**
 * Write a temporary file beside the target, then rename: a crash mid-write leaves the previous file intact rather than a truncated one `readStore` would move aside. The temp file carries the mode, so the rename is what makes `store.json` 0600.
 */
export async function writeStore(file: string, entries: StoreEntries): Promise<void> {
	await mkdir(dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(entries, null, "\t")}\n`, { mode: 0o600 });
		await rename(temporary, file);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}

function check(value: unknown, key: string, path: string, ancestors: Set<object>): void {
	if (value === null || typeof value === "string" || typeof value === "boolean") return;
	if (typeof value === "number") {
		if (Number.isFinite(value)) return;
		throw new CrustError(
			"bad-request",
			`store: key "${key}" holds a non-finite number at ${path}, which JSON cannot store`,
		);
	}
	if (typeof value !== "object") {
		throw new CrustError(
			"bad-request",
			`store: key "${key}" holds a ${typeof value} at ${path}, which JSON cannot store`,
		);
	}
	if (ancestors.has(value)) {
		throw new CrustError("bad-request", `store: key "${key}" holds a cycle at ${path}`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
		const kind = Object.prototype.toString.call(value).slice(8, -1);
		throw new CrustError(
			"bad-request",
			`store: key "${key}" holds a ${kind} at ${path}, which JSON cannot store`,
		);
	}
	ancestors.add(value);
	if (Array.isArray(value)) {
		// Indexed rather than `forEach`, which skips a hole that would serialize as `null`.
		for (let index = 0; index < value.length; index += 1) {
			check(value[index], key, `${path}[${index}]`, ancestors);
		}
	} else {
		for (const [name, item] of Object.entries(value)) {
			check(item, key, `${path}.${name}`, ancestors);
		}
	}
	ancestors.delete(value);
}

/**
 * Refuse a value JSON cannot hold unchanged, naming the key it was meant for. Without this an `undefined`, a function or a cycle reaches `JSON.stringify` and becomes `null`, a missing property or a throw with no key attached.
 */
export function assertJsonValue(value: unknown, key: string): void {
	check(value, key, key, new Set());
}
