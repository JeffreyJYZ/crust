/**
 * `window-state`'s every-window commands: one read of the state file, one write, and every window named in the answer — `saved`/`skipped` on a save, `restored`/`missing` on a restore. The frame seam is injected by `window-persist.ts`, so the adapter checks and the four-number validation live in one place.
 */

import type { NotImplemented } from "./define";
import { failure } from "./window-args.ts";
import { clearState, readState, type WindowFrame, writeState } from "./window-persist-store.ts";
import type { WindowFailure } from "./window-types.ts";

/** What a label's window answers and accepts, as `window-persist.ts` resolves it. */
export interface FrameCalls {
	read(label: string): WindowFrame;
	apply(label: string, frame: WindowFrame): void;
}

/** The plugin's own pieces: its adapter, its file, its refusal and its frame resolver. */
export interface WindowStateAllSeam {
	/** Only `list` is needed here; the frame members arrive through `calls`. */
	native?: { list(): string[] };
	file: string;
	missing: (command: string) => NotImplemented;
	calls: (native: { list(): string[] }) => FrameCalls;
	/** Serialise a read-modify-write on `file`, so concurrent commands see each other's commits. */
	lock: <T>(run: () => Promise<T>) => Promise<T>;
}

export interface WindowStateSaveAllResult {
	ok: true;
	saved: string[];
	/** Windows whose frame the platform could not answer; named, never dropped in silence. */
	skipped: string[];
}

export interface WindowStateRestoreAllResult {
	ok: true;
	restored: string[];
	/** Windows the file held no usable entry for; they open at their configured size. */
	missing: string[];
}

export interface WindowStateForgetAllResult {
	ok: true;
	/** Every label whose entry was dropped, so a caller can report what it forgot. */
	removed: string[];
}

export function windowStateAllCommands(seam: WindowStateAllSeam) {
	const { native, file, missing, calls, lock } = seam;

	const act = async <Result>(
		command: string,
		run: (adapter: { list(): string[] }) => Promise<Result>,
	): Promise<Result | WindowFailure | NotImplemented> => {
		if (native === undefined) return missing(command);
		try {
			return await run(native);
		} catch (error) {
			return failure(error);
		}
	};

	return {
		saveAll: () =>
			act("saveAll", async (adapter) => {
				const frames = calls(adapter);
				const saved: string[] = [];
				const skipped: string[] = [];
				await lock(async () => {
					const state = await readState(file);
					for (const label of adapter.list()) {
						try {
							state[label] = frames.read(label);
						} catch {
							// One unreadable frame is that window's problem: aborting would lose
							// the frames that are fine. Its old entry is left as it was.
							skipped.push(label);
							continue;
						}
						saved.push(label);
					}
					// One write for the whole set; nothing saved leaves the file untouched.
					if (saved.length > 0) await writeState(file, state);
				});
				return { ok: true as const, saved, skipped };
			}),

		restoreAll: () =>
			act("restoreAll", async (adapter) => {
				const frames = calls(adapter);
				const state = await readState(file);
				const restored: string[] = [];
				const absent: string[] = [];
				for (const label of adapter.list()) {
					const frame = state[label];
					if (frame === undefined) {
						absent.push(label);
						continue;
					}
					frames.apply(label, frame);
					restored.push(label);
				}
				return { ok: true as const, restored, missing: absent };
			}),

		forgetAll: () =>
			act("forgetAll", async () => {
				let removed: string[] = [];
				await lock(async () => {
					removed = Object.keys(await readState(file));
					await clearState(file);
				});
				return { ok: true as const, removed };
			}),
	};
}

export type WindowStateAllCommands = ReturnType<typeof windowStateAllCommands>;
