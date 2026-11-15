/**
 * The chrome commands: the title bar, the opacity and the pointer. Split from `window.ts` for the cap, and from `window-state.ts` because two of these take no label — the cursor is the app's, not a window's — so they run a gate of their own.
 * A payload is whatever the bridge parsed, so the value is read before the adapter is touched, and the label is resolved before the value: a ghost label answers `unknown-window` whatever the payload held, the same order the state commands use.
 */

import type { NotImplemented } from "./define";
import {
	type WindowChromeNative,
	type WindowCursor,
	type WindowCursorArgs,
	type WindowCursorResult,
	type WindowCursorVisibleArgs,
	type WindowCursorVisibleResult,
	type WindowDecorationsResult,
	type WindowOpacityResult,
	type WindowSetDecorationsArgs,
	type WindowSetOpacityArgs,
	WINDOW_CURSORS,
} from "./window-chrome-types.ts";
import { readFlag } from "./window-state-args.ts";
import { failure, invalidLabel, knownWindow, missingWindow, readLabel } from "./window-args.ts";
import type { WindowFailure, WindowNative } from "./window-types.ts";

type Read<Value> = { ok: true; value: Value } | { ok: false; failure: WindowFailure };

/** The shared refusal chain for the two labelled commands. */
type ChromeAct = <Result>(
	command: string,
	member: keyof WindowChromeNative,
	run: (native: WindowNative, label: string) => Result | WindowFailure,
	args: unknown,
) => Result | WindowFailure | NotImplemented;

/** Build the chrome commands for one adapter; the plugin spreads them in. */
export function windowChromeCommands(adapter?: WindowNative) {
	const act: ChromeAct = (command, member, run, args) => {
		if (!adapter) return missingWindow(command);
		const native = adapter;
		if (typeof native[member] !== "function") return unknownChromeAdapter(command, member);
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

	/** The pointer commands: no label, so no window lookup, only the member. */
	const send = <Result>(
		command: string,
		member: keyof WindowChromeNative,
		run: (native: WindowNative) => Result | WindowFailure,
	): Result | WindowFailure | NotImplemented => {
		if (!adapter) return missingWindow(command);
		const native = adapter;
		if (typeof native[member] !== "function") return unknownChromeAdapter(command, member);
		try {
			return run(native);
		} catch (error) {
			return failure(error);
		}
	};

	return {
		setDecorations: (
			args: WindowSetDecorationsArgs,
		): WindowDecorationsResult | WindowFailure | NotImplemented =>
			act(
				"setDecorations",
				"setDecorations",
				(native, label) => {
					const flag = readFlag(args);
					if (!flag.ok) return flag.failure;
					native.setDecorations?.(label, flag.value);
					return { ok: true as const, label, decorations: flag.value };
				},
				args,
			),
		isDecorated: (args: {
			label: string;
		}): WindowDecorationsResult | WindowFailure | NotImplemented =>
			act(
				"isDecorated",
				"isDecorated",
				(native, label) => ({
					ok: true as const,
					label,
					decorations: native.isDecorated?.(label) === true,
				}),
				args,
			),
		setOpacity: (
			args: WindowSetOpacityArgs,
		): WindowOpacityResult | WindowFailure | NotImplemented =>
			act(
				"setOpacity",
				"setOpacity",
				(native, label) => {
					const opacity = readOpacity(args);
					if (!opacity.ok) return opacity.failure;
					native.setOpacity?.(label, opacity.value);
					return { ok: true as const, label, opacity: opacity.value };
				},
				args,
			),
		opacity: (args: { label: string }): WindowOpacityResult | WindowFailure | NotImplemented =>
			act(
				"opacity",
				"opacity",
				(native, label) => {
					const applied = native.opacity?.(label);
					if (typeof applied !== "number") return noOpacity(label);
					return { ok: true as const, label, opacity: applied };
				},
				args,
			),
		setCursor: (args: WindowCursorArgs): WindowCursorResult | WindowFailure | NotImplemented =>
			send("setCursor", "setCursor", (native) => {
				const cursor = readCursor(args);
				if (!cursor.ok) return cursor.failure;
				native.setCursor?.(cursor.value);
				return { ok: true as const, cursor: cursor.value };
			}),
		setCursorVisible: (
			args: WindowCursorVisibleArgs,
		): WindowCursorVisibleResult | WindowFailure | NotImplemented =>
			send("setCursorVisible", "setCursorVisible", (native) => {
				const flag = readFlag(args);
				if (!flag.ok) return flag.failure;
				native.setCursorVisible?.(flag.value);
				return { ok: true as const, visible: flag.value };
			}),
	};
}

export type WindowChromeCommands = ReturnType<typeof windowChromeCommands>;

/** Refused, not clamped: 1.5 or -0.2 is a page bug a silently clipped window hides. */
function readOpacity(args: unknown, command = "setOpacity"): Read<number> {
	const value =
		typeof args === "object" && args !== null ? (args as { value?: unknown }).value : undefined;
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
		return {
			ok: false,
			failure: {
				ok: false,
				code: "invalid-value",
				message:
					`crust: window.${command} value must be a number from 0 to 1, got ` +
					`${JSON.stringify(value)} in ${JSON.stringify(args)}`,
			},
		};
	}
	return { ok: true, value };
}

/** A name outside `WINDOW_CURSORS` would leave the pointer untouched, so it is refused. */
function readCursor(args: unknown): Read<WindowCursor> {
	const cursor =
		typeof args === "object" && args !== null
			? (args as { cursor?: unknown }).cursor
			: undefined;
	if (typeof cursor !== "string" || !(WINDOW_CURSORS as readonly string[]).includes(cursor)) {
		return {
			ok: false,
			failure: {
				ok: false,
				code: "invalid-value",
				message:
					`crust: window.setCursor cursor must be one of ${WINDOW_CURSORS.join(", ")}, got ` +
					`${JSON.stringify(cursor)} in ${JSON.stringify(args)}`,
			},
		};
	}
	return { ok: true, value: cursor as WindowCursor };
}

/** A getter that answered nothing is an adapter bug, not an absent window. */
function noOpacity(label: string): WindowFailure {
	return {
		ok: false,
		code: "handler-error",
		message: `crust: window.opacity got no alpha back for ${JSON.stringify(label)}`,
		label,
	};
}

function unknownChromeAdapter(command: string, member: string): WindowFailure {
	return {
		ok: false,
		code: "unknown-adapter",
		message:
			`crust: this window adapter does not implement ${member}, which window.${command} needs. ` +
			"On macOS darwinWindowAdapter(platform) supplies it from window-chrome-adapter.ts.",
	};
}
