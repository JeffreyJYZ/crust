/**
 * `crust:window-state` — save, restore and forget a window's frame, so it reopens where it was. The native half and the data root are both injected: no AppKit here, and a test never writes into the real `Application Support`. The disk half (atomic write, the corrupt-is-empty rule) is `window-persist-store.ts`, re-exported below so callers import one module.
 * A corrupt or missing file is not an error — `restore` answers `{ restored: false }` and the window opens at its configured size, because refusing to open over a half-written JSON is worse than forgetting where it was.
 * The `…All` commands act on every label `list()` reports in one file read and one write, and name each window they could not save or had nothing saved for; they live in `window-persist-all.ts`.
 */

import { join } from "node:path";

import { definePlugin, notImplemented, type NotImplemented, type PluginDefinition } from "./define";
import { failure, invalidLabel, knownWindow, readLabel } from "./window-args.ts";
import { type WindowStateAllCommands, windowStateAllCommands } from "./window-persist-all.ts";
import {
	defaultStateRoot,
	readFrame,
	readState,
	STATE_FILE,
	type WindowFrame,
	withStateLock,
	writeState,
} from "./window-persist-store.ts";
import {
	WindowAdapterError,
	type WindowFailure,
	type WindowLabelArgs,
	type WindowPoint,
	type WindowSize,
} from "./window-types.ts";

export * from "./window-persist-store.ts";
export * from "./window-persist-all.ts";

/**
 * The native half: `list` plus the four frame calls, optional exactly as `WindowStateNative` has them, so a platform adapter is passed straight in and a missing member answers `unknown-adapter` instead of failing to compile.
 */
export interface WindowFrameNative {
	list(): string[];
	/** The liveness oracle; a closed window is pruned from `list()` on macOS but still known here. */
	isOpen?(label: string): boolean;
	getSize?(label: string): WindowSize;
	getPosition?(label: string): WindowPoint;
	setSize?(label: string, size: WindowSize): void;
	setPosition?(label: string, position: WindowPoint): void;
}

export interface WindowStateSaveResult {
	ok: true;
	label: string;
	frame: WindowFrame;
}

export interface WindowStateRestoreResult {
	ok: true;
	label: string;
	/** False when no usable entry existed; that is an answer, not a failure. */
	restored: boolean;
	frame?: WindowFrame;
}

export interface WindowStateForgetResult {
	ok: true;
	label: string;
	removed: boolean;
}

export interface WindowStateOptions {
	/** The platform's frame calls; absent answers `not-implemented`, as `crust:window` does. */
	native?: WindowFrameNative;
	/** Directory holding the state file. Defaults to `defaultStateRoot(app)`. */
	root?: string;
	/** App name for the default root, usually the config's `app.name`. */
	app?: string;
}

type WindowStateCommands = {
	save: (
		args: WindowLabelArgs,
	) => Promise<WindowStateSaveResult | WindowFailure | NotImplemented>;
	restore: (
		args: WindowLabelArgs,
	) => Promise<WindowStateRestoreResult | WindowFailure | NotImplemented>;
	forget: (
		args: WindowLabelArgs,
	) => Promise<WindowStateForgetResult | WindowFailure | NotImplemented>;
} & WindowStateAllCommands;

function missingState(command: string): NotImplemented {
	return notImplemented(
		`window-state.${command} needs the window plugin's frame calls, which this platform does ` +
			"not expose. Pass a WindowFrameNative adapter to createWindowStatePlugin where it has them.",
		"NSWindow",
	);
}

export function createWindowStatePlugin(
	options: WindowStateOptions = {},
): PluginDefinition<"window-state", WindowStateCommands> {
	const adapter = options.native;
	const file = join(options.root ?? defaultStateRoot(options.app ?? "crust"), STATE_FILE);

	const act = async <Result>(
		command: string,
		args: unknown,
		run: (native: WindowFrameNative, label: string) => Result | Promise<Result>,
	): Promise<Result | WindowFailure | NotImplemented> => {
		if (adapter === undefined) return missingState(command);
		const label = readLabel(args);
		if (label === undefined) return invalidLabel(args);
		const unknown = knownWindow(adapter, label);
		if (unknown) return unknown;
		try {
			return await run(adapter, label);
		} catch (error) {
			return failure(error, label);
		}
	};

	// The platform's frame members are optional, so a partial adapter is refused
	// by name instead of dying as a TypeError. `.call` keeps `this` on a class.
	const frames = (native: WindowFrameNative) => {
		const { getSize, getPosition, setSize, setPosition } = native;
		if (!getSize || !getPosition || !setSize || !setPosition) {
			throw new WindowAdapterError(
				"unknown-adapter",
				"crust: window-state needs getSize, getPosition, setSize and setPosition",
			);
		}
		return {
			read: (label: string): WindowFrame => {
				const point = getPosition.call(native, label);
				const size = getSize.call(native, label);
				const frame = readFrame({ ...point, ...size });
				if (frame === undefined) {
					throw new WindowAdapterError(
						"handler-error",
						`crust: window ${JSON.stringify(label)} answered a frame that is not four numbers`,
					);
				}
				return frame;
			},
			apply: (label: string, frame: WindowFrame): void => {
				setSize.call(native, label, { width: frame.width, height: frame.height });
				setPosition.call(native, label, { x: frame.x, y: frame.y });
			},
		};
	};

	return definePlugin({
		name: "window-state",
		commands: {
			save: (args: WindowLabelArgs) =>
				act("save", args, async (native, label) => {
					const frame = frames(native).read(label);
					await withStateLock(file, async () => {
						const state = await readState(file);
						state[label] = frame;
						await writeState(file, state);
					});
					return { ok: true as const, label, frame };
				}),

			restore: (args: WindowLabelArgs) =>
				act("restore", args, async (native, label) => {
					const calls = frames(native);
					const frame = (await readState(file))[label];
					if (frame === undefined)
						return { ok: true as const, label, restored: false as const };
					calls.apply(label, frame);
					return { ok: true as const, label, restored: true as const, frame };
				}),

			forget: (args: WindowLabelArgs) =>
				act("forget", args, async (_native, label) => {
					let removed = false;
					await withStateLock(file, async () => {
						const state = await readState(file);
						if (state[label] === undefined) return;
						removed = true;
						delete state[label];
						await writeState(file, state);
					});
					return { ok: true as const, label, removed };
				}),

			// Every window at once: the plugin's own seam, handed over so the file is
			// read and written once per call rather than once per window.
			...windowStateAllCommands({
				native: adapter,
				file,
				missing: missingState,
				calls: frames,
				lock: (run) => withStateLock(file, run),
			}),
		},
	});
}

/** The default registration: honest about the missing platform. */
export const windowStatePlugin = createWindowStatePlugin();
