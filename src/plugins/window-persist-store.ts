/**
 * `window-state`'s disk half: one JSON file of `{ label: { x, y, width, height } }` under the app's data directory. Kept apart from the command wiring so the atomic write and the "corrupt is empty" rule can be read — and changed — without the plugin's typed answers in the way.
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { withFileLock } from "./store-file.ts";

/** A window's frame in screen points, `y` growing upward as AppKit's does. */
export interface WindowFrame {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** One file for every label, so a save never scans a directory. */
export const STATE_FILE = "window-state.json";

/**
 * macOS's per-app data directory. `CRUST_DATA_DIR` wins, because a packaged app is launched with `/` as cwd and already knows its own root.
 */
export function defaultStateRoot(app: string): string {
	const override = process.env.CRUST_DATA_DIR;
	if (override !== undefined && override.length > 0) return override;
	return join(homedir(), "Library", "Application Support", app);
}

/**
 * The directory `crust dev` lends this run, or `undefined` when nothing did.
 *
 * A window frame is remembered for the life of one `crust dev` process only: the runner creates
 * this directory, every restarted child reads and writes the frame there, and the runner deletes it
 * when it stops. So a new `crust dev` starts empty and opens at the configured size, with no cleanup
 * code in the app. A `crust build` output has no runner and therefore no such variable, so it keeps
 * the pre-existing behaviour — configured size, no remembered frame. That is a decision, not a bug:
 * window state does not persist in a production build, and it never writes into the app's own data
 * directory behind the human's back.
 */
export function devWindowStateRoot(): string | undefined {
	const override = process.env.CRUST_WINDOW_STATE_DIR;
	return override !== undefined && override.length > 0 ? override : undefined;
}

function isNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/** A usable frame, or `undefined` for anything a corrupt entry could hold. */
export function readFrame(value: unknown): WindowFrame | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const { x, y, width, height } = value as Record<string, unknown>;
	if (!isNumber(x) || !isNumber(y) || !isNumber(width) || !isNumber(height)) return undefined;
	return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}

/**
 * A state map with no inherited keys. A window label is any non-empty string, so
 * `"__proto__"` is legal; on a plain `{}` that assignment invokes the inherited
 * setter instead of storing a frame, and a later read answers `Object.prototype`.
 * A null prototype makes every label an ordinary own property, in `save` as well
 * as here — every writer starts from `readState`.
 */
function emptyState(): Record<string, WindowFrame> {
	return Object.create(null) as Record<string, WindowFrame>;
}

/** Every entry that survives validation; a missing, unreadable or corrupt file is an empty state. */
export async function readState(file: string): Promise<Record<string, WindowFrame>> {
	const text = await readFile(file, "utf8").catch(() => undefined);
	if (text === undefined) return emptyState();
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return emptyState();
	}
	if (typeof parsed !== "object" || parsed === null) return emptyState();
	const state = emptyState();
	for (const [label, value] of Object.entries(parsed)) {
		const frame = readFrame(value);
		if (frame !== undefined) state[label] = frame;
	}
	return state;
}

/**
 * Serialise a state-file mutation. A save is a read-modify-write, so two windows saved together
 * must re-read inside the lock or the later commit drops the earlier frame. The lock is shared
 * per path with the store's, so every plugin instance pointing at this file uses one chain.
 */
export function withStateLock<T>(file: string, run: () => Promise<T>): Promise<T> {
	return withFileLock(file, run);
}

/** Drop the whole file; a missing file is already the empty state `readState` answers. */
export async function clearState(file: string): Promise<void> {
	await rm(file, { force: true });
}

/**
 * Write a temporary file in the same directory, then rename: a crash mid-write leaves the previous file intact rather than a truncated one `readState` would silently discard.
 */
export async function writeState(file: string, state: Record<string, WindowFrame>): Promise<void> {
	await mkdir(dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(state, null, "\t")}\n`);
		await rename(temporary, file);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}
