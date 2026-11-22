/**
 * `crust:screen` — every display the machine has: its bounds, its work area, its scale and which
 * one is primary. The native half is injected, never queried here, so this module holds no AppKit
 * and a test states the displays it means exactly as `positioner` does.
 *
 * Bounds and the work area are in **top-left page pixels**, the one coordinate system a caller
 * reads: `x` grows right from the left edge of the primary display, `y` grows **down** from its
 * top. AppKit's own origin is bottom-left, so the darwin half flips it once, at the seam, and every
 * page and every window call then agrees about which way is up. A display left of or above the
 * primary answers a negative `x` or `y`, which is where it really is.
 *
 * A platform that cannot enumerate displays answers `not-implemented` naming what it needs, rather
 * than an empty list that reads as "no screen".
 */

import { definePlugin, type NotImplemented, notImplemented, type PluginDefinition } from "./define";

/** A rectangle in top-left page pixels: `x` right of the primary's left edge, `y` down from its top. */
export interface ScreenBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** One display, as the native half reports it. */
export interface ScreenRecord {
	/** Stable for the life of a launch: AppKit's index, so `"0"` is the primary. */
	readonly id: string;
	readonly primary: boolean;
	/** `-[NSScreen backingScaleFactor]`: 2 on a Retina display, 1 otherwise. */
	readonly scale: number;
	/** The whole display. */
	readonly bounds: ScreenBounds;
	/** The part a window may use: bounds minus the menu bar and the Dock. */
	readonly workArea: ScreenBounds;
}

/** The native half of `crust:screen`; `platform/darwin/screen.ts` implements `listScreens`. */
export interface ScreenAdapter {
	/** Every display, primary first when the platform orders it that way. */
	list(): ScreenRecord[] | Promise<ScreenRecord[]>;
}

export interface ScreenOptions {
	/** The native half. Absent answers `not-implemented` rather than an empty list. */
	adapter?: ScreenAdapter;
	/**
	 * What a refusal names: the selector or call this platform would need. Each platform has its
	 * own, so a Windows user is told `EnumDisplayMonitors` instead of a selector Windows lacks.
	 */
	requires?: string;
}

export interface ScreenListResult {
	ok: true;
	screens: ScreenRecord[];
}

export interface ScreenPrimaryResult {
	ok: true;
	screen: ScreenRecord;
}

/** A refusal that is not a missing platform: the platform listed nothing usable. */
export interface ScreenFailure {
	ok: false;
	code: "handler-error";
	message: string;
}

/** The commands in the order this plugin declares them. */
export const SCREEN_COMMANDS = ["list", "primary"] as const;

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/** A rectangle with four finite numbers and a positive area, or nothing this plugin will answer. */
function usable(bounds: ScreenBounds | undefined): boolean {
	if (bounds === undefined) return false;
	const { x, y, width, height } = bounds;
	if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
	return isFiniteNumber(width) && isFiniteNumber(height) && width > 0 && height > 0;
}

/**
 * One record, or nothing when any field a caller would act on is missing. A display with no usable
 * bounds is dropped rather than answered as a zero rectangle, because a window placed on a 0×0
 * screen lands off every display and looks like a success.
 */
function clean(record: ScreenRecord | undefined, index: number): ScreenRecord | undefined {
	if (record === undefined || record === null) return undefined;
	const { id, primary, scale, bounds, workArea } = record;
	if (!usable(bounds) || !usable(workArea)) return undefined;
	// The id is the platform's own label; a record without one is named by its position, which is
	// what AppKit's index is, rather than dropped for want of a cosmetic field.
	const named = typeof id === "string" ? id : typeof id === "number" ? String(id) : "";
	return {
		id: named.length === 0 ? String(index) : named,
		primary: primary === true,
		scale: isFiniteNumber(scale) && scale > 0 ? scale : 1,
		bounds: { ...bounds },
		workArea: { ...workArea },
	};
}

export function createScreenPlugin(options: ScreenAdapter | ScreenOptions = {}): PluginDefinition<
	"screen",
	{
		list: () => Promise<ScreenListResult | NotImplemented>;
		primary: () => Promise<ScreenPrimaryResult | ScreenFailure | NotImplemented>;
	}
> {
	// A bare adapter is accepted because that is the shape the other plugin constructors take.
	const resolved: ScreenOptions = "list" in options ? { adapter: options } : options;
	const adapter = resolved.adapter;
	const requires = resolved.requires ?? "NSScreen";
	/** Read and clean in one pass, so both commands agree about what a usable display is. */
	const screens = async (): Promise<ScreenRecord[]> => {
		if (adapter === undefined) return [];
		const reported = await adapter.list();
		if (!Array.isArray(reported)) return [];
		const cleaned: ScreenRecord[] = [];
		for (const [index, record] of reported.entries()) {
			const entry = clean(record, index);
			if (entry !== undefined) cleaned.push(entry);
		}
		return cleaned;
	};

	const missing = (command: string) =>
		notImplemented(
			`screen.${command} needs ${requires}, which this platform does not provide. Pass a ` +
				"ScreenAdapter to createScreenPlugin on a platform that cannot enumerate displays.",
			requires,
		);

	return definePlugin({
		name: "screen",
		native: { requires, available: adapter !== undefined },
		commands: {
			/**
			 * Every display. An empty list is a real answer for a headless process rather than a
			 * failure: nothing is connected, which is not the same as nothing being possible.
			 */
			list: async (): Promise<ScreenListResult | NotImplemented> => {
				if (adapter === undefined) return missing("list");
				return { ok: true, screens: await screens() };
			},

			/**
			 * The display a window should open on: the one the platform marks primary, or the first
			 * one it listed. `[NSScreen screens][0]` is precisely that on macOS, so the fallback
			 * agrees with the native answer rather than inventing a second rule.
			 */
			primary: async (): Promise<ScreenPrimaryResult | ScreenFailure | NotImplemented> => {
				if (adapter === undefined) return missing("primary");
				const listed = await screens();
				const screen = listed.find((entry) => entry.primary) ?? listed[0];
				if (screen === undefined) {
					return {
						ok: false,
						code: "handler-error",
						message: "screen.primary: the platform listed no usable display",
					};
				}
				return { ok: true, screen };
			},
		},
	});
}

/** What a platform without an adapter would need, so the refusal names the right call there. */
const REQUIRES: Record<string, string> = {
	darwin: "NSScreen screens",
	win32: "EnumDisplayMonitors",
	linux: "gdk_display_get_monitor",
};

/** The default registration: honest about the missing framework, naming its own platform's call. */
export const screenPlugin = createScreenPlugin({
	requires: REQUIRES[process.platform] ?? "a display enumerator",
});
