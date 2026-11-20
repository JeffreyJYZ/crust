/**
 * The frame a `crust dev` run remembers while it runs, and nothing more.
 *
 * `crust dev` restarts its child on a backend edit, and the restarted window used to reopen at the
 * configured size instead of where the human left it. This watches every open window's frame while
 * the run lives, writes it to the runner's own state directory after the frame settles, and applies
 * it to the window the next child creates.
 *
 * Two rules are why it is a poll and not a close hook: a restart is a signal or a `process.exit`
 * that never reaches a clean shutdown, so a save that only runs in `before-quit` loses exactly the
 * size that made the human care; and `window.close` receives no frame afterwards, so the last
 * observed one is kept and written even once the label is gone.
 *
 * The store, the atomic write and the corrupt-is-empty rule are `window-persist-store.ts`; the
 * visibility rule is `window-frame.ts`. Nothing here runs in a built app: the plugin builds no
 * memory unless the dev runner lent it a directory.
 */

import { type FrameRect, restorableFrame } from "./window-frame.ts";
import {
	readFrame,
	readState,
	type WindowFrame,
	withStateLock,
	writeState,
} from "./window-persist-store.ts";

/** How often every open window's frame is read. Cheap: four numbers per label. */
export const FRAME_POLL_MS = 400;

/** How long a frame must stop moving before it is written, so a drag is one write. */
export const FRAME_DEBOUNCE_MS = 250;

/** The platform's frame calls: the same subset `window-state` drives. */
export interface FrameMemoryNative {
	list(): string[];
	getSize?(label: string): { width: number; height: number };
	getPosition?(label: string): { x: number; y: number };
	setSize?(label: string, size: { width: number; height: number }): void;
	setPosition?(label: string, position: { x: number; y: number }): void;
}

export interface FrameMemoryOptions {
	native: FrameMemoryNative;
	/** The state file, inside the directory the dev runner owns for this run. */
	file: string;
	/** Every display's work area, in the same coordinate space the frames use. */
	workAreas: () => readonly FrameRect[];
	pollMs?: number;
	debounceMs?: number;
}

export interface FrameMemory {
	/** The entries that are still visible on this machine, by label. */
	restorable(): Promise<Record<string, WindowFrame>>;
	/** Apply a frame to a window that already exists. */
	place(label: string, frame: WindowFrame): void;
	/** Read every open frame now and schedule a write if one moved. */
	sample(): void;
	/** Sample on a timer until `stop`. */
	observe(): void;
	/** Write every known frame now, including one whose window has closed. */
	saveAll(): Promise<void>;
	/** Settle a pending debounce by writing now; a no-op with nothing pending. */
	flush(): Promise<void>;
	/** Stop observing. Does not write: callers that care call `saveAll` first. */
	stop(): void;
}

function sameFrame(a: WindowFrame, b: WindowFrame): boolean {
	return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function createFrameMemory(options: FrameMemoryOptions): FrameMemory {
	const { native, file, workAreas } = options;
	const pollMs = options.pollMs ?? FRAME_POLL_MS;
	const debounceMs = options.debounceMs ?? FRAME_DEBOUNCE_MS;
	/** The last frame each label answered, kept after the window closes. */
	const known = new Map<string, WindowFrame>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let interval: ReturnType<typeof setInterval> | undefined;

	const read = (label: string): WindowFrame | undefined => {
		const { getSize, getPosition } = native;
		if (!getSize || !getPosition) return undefined;
		try {
			return readFrame({
				...getPosition.call(native, label),
				...getSize.call(native, label),
			});
		} catch {
			// One unreadable frame is that window's problem; the others still save.
			return undefined;
		}
	};

	const write = async (): Promise<void> => {
		// A closed label has no frame to read, so its last observed one is what gets written.
		const frames = new Map(known);
		for (const label of native.list()) {
			const frame = read(label);
			if (frame !== undefined) frames.set(label, frame);
		}
		if (frames.size === 0) return;
		await withStateLock(file, async () => {
			const state = await readState(file);
			for (const [label, frame] of frames) state[label] = frame;
			await writeState(file, state);
		});
	};

	const saveAll = (): Promise<void> => write();

	const schedule = (): void => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			void saveAll();
		}, debounceMs);
		timer.unref?.();
	};

	const sample = (): void => {
		let moved = false;
		for (const label of native.list()) {
			const frame = read(label);
			if (frame === undefined) continue;
			const previous = known.get(label);
			if (previous !== undefined && sameFrame(previous, frame)) continue;
			known.set(label, frame);
			moved = true;
		}
		if (moved) schedule();
	};

	return {
		async restorable() {
			const areas = workAreas();
			const usable: Record<string, WindowFrame> = Object.create(null);
			for (const [label, frame] of Object.entries(await readState(file))) {
				if (!restorableFrame(frame, areas)) continue;
				usable[label] = frame;
				// Seed the last sample, so applying a restored frame is not itself a change.
				known.set(label, frame);
			}
			return usable;
		},

		place(label, frame) {
			native.setSize?.call(native, label, {
				width: frame.width,
				height: frame.height,
			});
			native.setPosition?.call(native, label, { x: frame.x, y: frame.y });
		},

		sample,

		observe() {
			if (interval !== undefined) return;
			interval = setInterval(sample, pollMs);
			interval.unref?.();
		},

		saveAll,

		async flush() {
			if (timer === undefined) return;
			clearTimeout(timer);
			timer = undefined;
			await saveAll();
		},

		stop() {
			if (interval !== undefined) clearInterval(interval);
			interval = undefined;
			clearTimeout(timer);
			timer = undefined;
		},
	};
}

/**
 * The one memory a process has, set where the dev directory and the platform adapter meet
 * (`createWindowStatePlugin`) and read where windows are created (`openWindows`). A module-level
 * singleton is the same seam `app-watch.ts` uses for page sinks: a process runs one window set, so
 * one holder cannot go ambiguous.
 */
let active: FrameMemory | undefined;

export function setFrameMemory(memory: FrameMemory | undefined): void {
	active = memory;
}

export function frameMemory(): FrameMemory | undefined {
	return active;
}
