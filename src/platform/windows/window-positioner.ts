/**
 * `crust:positioner` on Windows: the primary display's work area, and the axis the plugin needs to
 * compute in it.
 *
 * The plugin's arithmetic (`positioner.ts`) is not duplicated here. What Windows has to supply is the
 * frame a placement is measured against and the direction `y` grows in: AppKit's grows up, Win32's
 * grows down, so a straight port put `topLeft` at the bottom edge. The plugin takes `axis: "down"` and
 * computes the answer itself, which matters because a command returns **the point it moved the window
 * to** — flipping the value on the way out would report one number and move to another.
 *
 * **The frame is `rcWork`, the work area**, not the monitor rect: it already excludes the taskbar, so a
 * `bottomLeft` window sits above it instead of under it.
 */
import type { PositionerNative, PositionerOptions, ScreenBounds } from "@/plugins/positioner";
import type { ScreenRecord } from "@/plugins/screen";
import type { WindowNative } from "@/plugins/window";
import { windowsScreenAdapter } from "./screen.ts";

/** The work area of one display, in Win32 pixels: y down, taskbar excluded. */
interface WorkArea {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A display list source; the real one enumerates monitors through the shim. */
export type DisplaySource = () => readonly ScreenRecord[];

/**
 * The real display list, read synchronously. `ScreenAdapter.list` is typed to allow a promise for the
 * platforms whose enumeration is asynchronous; the Windows one answers an array, and a source that
 * cannot answer now yields no frame, which the plugin refuses by name rather than placing wrongly.
 */
function displaysNow(): readonly ScreenRecord[] {
	const list = windowsScreenAdapter().list();
	return Array.isArray(list) ? list : [];
}

/** The window calls the plugin makes. Narrowed so a partial adapter cannot compile here by accident. */
type MovableWindow = Pick<WindowNative, "list" | "getSize" | "setPosition">;

/** The primary display's work area, or the first one when nothing is marked primary. */
export function primaryWorkArea(displays: readonly ScreenRecord[]): WorkArea | undefined {
	const primary = displays.find((display) => display.primary) ?? displays[0];
	if (primary === undefined) return undefined;
	const { x, y, width, height } = primary.workArea;
	if (![x, y, width, height].every((value) => Number.isFinite(value))) return undefined;
	return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}

/**
 * The `{ native, screen, axis }` triple `createPositionerPlugin` takes. `displays` is injected so the
 * choice is provable on a machine with no monitors, the same rule `windowsScreenAdapter` follows.
 */
export function windowsPositioner(
	window: MovableWindow,
	displays: DisplaySource = displaysNow,
): PositionerOptions {
	const workArea = (): WorkArea | undefined => primaryWorkArea(displays());

	/** The frame the plugin measures against: the work area, in Win32's own y-down numbers. */
	const screen = (): ScreenBounds | undefined => {
		const area = workArea();
		if (area === undefined) return undefined;
		return { x: area.x, y: area.y, width: area.width, height: area.height };
	};

	const sizeOf = (label: string): { width: number; height: number } => {
		const size = window.getSize?.(label);
		if (size === undefined) {
			throw new Error(`crust: positioner needs a size for ${JSON.stringify(label)}`);
		}
		return size;
	};

	const native: PositionerNative = {
		list: () => window.list(),
		getSize: sizeOf,
		// The point arrives in Win32 coordinates already: `axis: "down"` made the plugin compute them.
		setPosition: (label, point) => window.setPosition?.(label, point),
	};

	return { native, screen, axis: "down" };
}
