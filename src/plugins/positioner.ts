/**
 * `crust:positioner` — put a window at one of nine places on the main screen: centred, a corner, or an edge midpoint of its visible frame. The screen's visible frame is injected, never queried, so this module holds no AppKit and a test states the screen it means.
 * `y` grows upward, as AppKit's does, so "top" is the largest `y`: a `topLeft` window sits under the menu bar and a `bottomLeft` one above the dock.
 */

import { definePlugin, type NotImplemented, notImplemented, type PluginDefinition } from "./define";
import { failure, invalidLabel, readLabel, unknownWindow } from "./window-args.ts";
import {
	WindowAdapterError,
	type WindowFailure,
	type WindowLabelArgs,
	type WindowPoint,
	type WindowSize,
} from "./window-types.ts";

/** A rectangle in screen points; the main screen's visible frame is the one that excludes menu bar and dock. */
export interface ScreenBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** The native half: what a move needs, optional exactly as `WindowStateNative` has them, so a platform adapter is passed straight in. */
export interface PositionerNative {
	list(): string[];
	getSize?(label: string): WindowSize;
	setPosition?(label: string, position: WindowPoint): void;
}

/** A fixed frame, or a reader for a display that can change under a running app. */
export type ScreenSource = ScreenBounds | (() => ScreenBounds | undefined);

export interface PositionerResult {
	readonly ok: true;
	readonly label: string;
	readonly x: number;
	readonly y: number;
	readonly placed: true;
}

export interface PositionerOptions {
	/** The platform's move calls; absent answers `not-implemented`, as `crust:window` does. */
	native?: PositionerNative;
	/** The main screen's visible frame, from `-[NSScreen visibleFrame]`. */
	screen?: ScreenSource;
}

/** The placements Tauri names, in the order this plugin declares them. */
export const POSITIONER_PLACEMENTS = [
	"center",
	"topLeft",
	"topRight",
	"bottomLeft",
	"bottomRight",
	"topCenter",
	"bottomCenter",
	"leftCenter",
	"rightCenter",
] as const;

export type Placement = (typeof POSITIONER_PLACEMENTS)[number];

type PositionerAnswer = Promise<PositionerResult | WindowFailure | NotImplemented>;

type PositionerCommands = Record<Placement, (args: WindowLabelArgs) => PositionerAnswer>;

function isNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/** The frame the injected screen answered, or `undefined` for anything that is not a usable rectangle. */
function usable(bounds: ScreenBounds | undefined): ScreenBounds | undefined {
	if (bounds === undefined) return undefined;
	const { x, y, width, height } = bounds;
	if (!isNumber(x) || !isNumber(y) || !isNumber(width) || !isNumber(height)) return undefined;
	return width > 0 && height > 0 ? bounds : undefined;
}

/**
 * Where a window of `size` lands for `placement`, rounded to whole points because a move takes points.
 * A window larger than the screen keeps the negative offset: clamping would report a success the user cannot see.
 */
function place(
	placement: Placement,
	screen: ScreenBounds,
	size: { width: number; height: number },
): { x: number; y: number } {
	const left = Math.round(screen.x);
	const right = Math.round(screen.x + screen.width - size.width);
	const bottom = Math.round(screen.y);
	const top = Math.round(screen.y + screen.height - size.height);
	// One half-up `Math.round` on the slack, offset from the near edge, so every centred axis agrees.
	const middleX = left + Math.round((screen.width - size.width) / 2);
	const middleY = bottom + Math.round((screen.height - size.height) / 2);
	switch (placement) {
		case "topLeft":
			return { x: left, y: top };
		case "topRight":
			return { x: right, y: top };
		case "bottomLeft":
			return { x: left, y: bottom };
		case "bottomRight":
			return { x: right, y: bottom };
		case "topCenter":
			return { x: middleX, y: top };
		case "bottomCenter":
			return { x: middleX, y: bottom };
		case "leftCenter":
			return { x: left, y: middleY };
		case "rightCenter":
			return { x: right, y: middleY };
		default:
			return { x: middleX, y: middleY };
	}
}

export function createPositionerPlugin(
	options: PositionerOptions = {},
): PluginDefinition<"positioner", PositionerCommands> {
	const adapter = options.native;
	const source = options.screen;
	const bounds = (): ScreenBounds | undefined =>
		typeof source === "function" ? source() : source;

	const act = async <Result>(
		command: string,
		args: unknown,
		run: (native: PositionerNative, label: string) => Result | Promise<Result>,
	): Promise<Result | WindowFailure | NotImplemented> => {
		if (adapter === undefined) {
			return notImplemented(
				`positioner.${command} needs NSWindow, which this platform does not expose. ` +
					"Pass a PositionerNative adapter to createPositionerPlugin where it has one.",
				"NSWindow",
			);
		}
		const label = readLabel(args);
		if (label === undefined) return invalidLabel(args);
		if (!adapter.list().includes(label)) return unknownWindow(label);
		try {
			return await run(adapter, label);
		} catch (error) {
			return failure(error, label);
		}
	};

	const command = (placement: Placement) => (args: WindowLabelArgs) =>
		act(placement, args, (native, label) => {
			const { getSize, setPosition } = native;
			if (!getSize || !setPosition) {
				throw new WindowAdapterError(
					"unknown-adapter",
					"crust: positioner needs getSize and setPosition",
				);
			}
			const screen = usable(bounds());
			if (screen === undefined) {
				throw new WindowAdapterError(
					"unknown-adapter",
					`crust: positioner.${placement} has no usable screen frame; pass one as { screen }`,
				);
			}
			// `.call` keeps `this` on a platform whose adapter is a class.
			const { x, y } = place(placement, screen, getSize.call(native, label));
			setPosition.call(native, label, { x, y });
			return { ok: true as const, label, x, y, placed: true as const };
		});

	return definePlugin({
		name: "positioner",
		commands: {
			center: command("center"),
			topLeft: command("topLeft"),
			topRight: command("topRight"),
			bottomLeft: command("bottomLeft"),
			bottomRight: command("bottomRight"),
			topCenter: command("topCenter"),
			bottomCenter: command("bottomCenter"),
			leftCenter: command("leftCenter"),
			rightCenter: command("rightCenter"),
		},
	});
}

/** The default registration: honest about the missing platform. */
export const positionerPlugin = createPositionerPlugin();
