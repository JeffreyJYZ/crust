/**
 * The three window-level commands: fullscreen, minimize and maximize. Split from `window-state.ts` so each file stays one screen; these are the ones that answer a state the window did not have before, so every result reports the state that follows rather than "done".
 */

import type { NotImplemented } from "./define";
import { readFlag } from "./window-state-args.ts";
import type {
	WindowFlagArgs,
	WindowFullscreenResult,
	WindowMaximizedResult,
	WindowMinimizedResult,
	WindowStateNative,
} from "./window-state-types.ts";
import type { WindowFailure, WindowNative } from "./window-types.ts";

/**
 * The gate every state command shares: no adapter, no member, no label, no such
 * window, then the send. `window-state.ts` owns the one instance and passes it
 * here, so both halves refuse in exactly the same order.
 */
export type StateAct = <Result>(
	command: string,
	member: keyof WindowStateNative,
	run: (native: WindowNative, label: string) => Result | WindowFailure,
	args: unknown,
) => Result | WindowFailure | NotImplemented;

/** The fullscreen, minimize and maximize commands, built on a shared gate. */
export function windowToggleCommands(act: StateAct) {
	return {
		setFullscreen: (
			args: WindowFlagArgs,
		): WindowFullscreenResult | WindowFailure | NotImplemented =>
			act(
				"setFullscreen",
				"setFullscreen",
				(native, label) => {
					const flag = readFlag(args);
					if (!flag.ok) return flag.failure;
					native.setFullscreen?.(label, flag.value);
					return { ok: true as const, label, fullscreen: flag.value };
				},
				args,
			),
		isFullscreen: (args: {
			label: string;
		}): WindowFullscreenResult | WindowFailure | NotImplemented =>
			act(
				"isFullscreen",
				"isFullscreen",
				(native, label) => ({
					ok: true as const,
					label,
					fullscreen: native.isFullscreen?.(label) === true,
				}),
				args,
			),
		minimize: (args: {
			label: string;
		}): WindowMinimizedResult | WindowFailure | NotImplemented =>
			act(
				"minimize",
				"minimize",
				(native, label) => {
					native.minimize?.(label);
					return { ok: true as const, label, minimized: true as const };
				},
				args,
			),
		unminimize: (args: {
			label: string;
		}): WindowMinimizedResult | WindowFailure | NotImplemented =>
			act(
				"unminimize",
				"unminimize",
				(native, label) => {
					native.unminimize?.(label);
					return { ok: true as const, label, minimized: false as const };
				},
				args,
			),
		isMinimized: (args: {
			label: string;
		}): WindowMinimizedResult | WindowFailure | NotImplemented =>
			act(
				"isMinimized",
				"isMinimized",
				(native, label) => ({
					ok: true as const,
					label,
					minimized: native.isMinimized?.(label) === true,
				}),
				args,
			),
		maximize: (args: {
			label: string;
		}): WindowMaximizedResult | WindowFailure | NotImplemented =>
			act(
				"maximize",
				"maximize",
				(native, label) => {
					native.maximize?.(label);
					return { ok: true as const, label, maximized: true as const };
				},
				args,
			),
		isMaximized: (args: {
			label: string;
		}): WindowMaximizedResult | WindowFailure | NotImplemented =>
			act(
				"isMaximized",
				"isMaximized",
				(native, label) => ({
					ok: true as const,
					label,
					maximized: native.isMaximized?.(label) === true,
				}),
				args,
			),
	};
}
