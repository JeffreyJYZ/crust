/**
 * The window state commands: size, position and always-on-top here, fullscreen and the two window-level toggles in `window-state-toggles.ts`. Split out of `window.ts`, which keeps the original six, because these are thirteen more and each is the same four steps — the adapter, its member, the label, then the selector.
 * A member the adapter lacks answers `unknown-adapter` instead of pretending, the way `create` does. The label is resolved before the value, so a ghost label answers `unknown-window` whatever the payload held.
 */

import type { NotImplemented } from "./define";
import { readFlag, readPoint, readSize, unknownAdapter } from "./window-state-args.ts";
import type {
	WindowAlwaysOnTopResult,
	WindowFlagArgs,
	WindowPositionResult,
	WindowSetPositionArgs,
	WindowSetSizeArgs,
	WindowSizeResult,
	WindowStateNative,
} from "./window-state-types.ts";
import { type StateAct, windowToggleCommands } from "./window-state-toggles.ts";
import { failure, invalidLabel, knownWindow, missingWindow, readLabel } from "./window-args.ts";
import type { WindowFailure, WindowNative } from "./window-types.ts";

/** Build the state commands for one adapter; the plugin spreads them in. */
export function windowStateCommands(adapter?: WindowNative) {
	const act: StateAct = (command, member, run, args) => {
		if (!adapter) return missingWindow(command);
		const native = adapter;
		if (typeof native[member] !== "function") return unknownAdapter(command, member);
		const label = readLabel(args);
		if (label === undefined) return invalidLabel(args);
		const unknown = knownWindow(native, label);
		if (unknown) return unknown;
		try {
			return run(native, label);
		} catch (error) {
			return failure(error, label);
		}
	};

	return {
		setSize: (args: WindowSetSizeArgs): WindowSizeResult | WindowFailure | NotImplemented =>
			act(
				"setSize",
				"setSize",
				(native, label) => {
					const size = readSize(args);
					if (!size.ok) return size.failure;
					native.setSize?.(label, size.value);
					return { ok: true as const, label, ...size.value };
				},
				args,
			),
		getSize: (args: { label: string }): WindowSizeResult | WindowFailure | NotImplemented =>
			act(
				"getSize",
				"getSize",
				(native, label) => {
					const size = native.getSize?.(label);
					if (!size) return noGeometry(label, "getSize");
					return { ok: true as const, label, width: size.width, height: size.height };
				},
				args,
			),
		setPosition: (
			args: WindowSetPositionArgs,
		): WindowPositionResult | WindowFailure | NotImplemented =>
			act(
				"setPosition",
				"setPosition",
				(native, label) => {
					const point = readPoint(args);
					if (!point.ok) return point.failure;
					native.setPosition?.(label, point.value);
					return { ok: true as const, label, ...point.value };
				},
				args,
			),
		getPosition: (args: {
			label: string;
		}): WindowPositionResult | WindowFailure | NotImplemented =>
			act(
				"getPosition",
				"getPosition",
				(native, label) => {
					const point = native.getPosition?.(label);
					if (!point) return noGeometry(label, "getPosition");
					return { ok: true as const, label, x: point.x, y: point.y };
				},
				args,
			),
		setAlwaysOnTop: (
			args: WindowFlagArgs,
		): WindowAlwaysOnTopResult | WindowFailure | NotImplemented =>
			act(
				"setAlwaysOnTop",
				"setAlwaysOnTop",
				(native, label) => {
					const flag = readFlag(args);
					if (!flag.ok) return flag.failure;
					native.setAlwaysOnTop?.(label, flag.value);
					return { ok: true as const, label, alwaysOnTop: flag.value };
				},
				args,
			),
		isAlwaysOnTop: (args: {
			label: string;
		}): WindowAlwaysOnTopResult | WindowFailure | NotImplemented =>
			act(
				"isAlwaysOnTop",
				"isAlwaysOnTop",
				(native, label) => ({
					ok: true as const,
					label,
					alwaysOnTop: native.isAlwaysOnTop?.(label) === true,
				}),
				args,
			),
		...windowToggleCommands(act),
	};
}

/** A getter that answered nothing is an adapter bug, not an absent window. */
function noGeometry(label: string, command: string): WindowFailure {
	return {
		ok: false,
		code: "handler-error",
		message: `crust: window.${command} got no geometry back for ${JSON.stringify(label)}`,
		label,
	};
}

export type WindowStateCommands = ReturnType<typeof windowStateCommands>;
