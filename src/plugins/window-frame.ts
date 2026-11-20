/**
 * Whether a remembered window frame is still visible on the machine as it is now.
 *
 * A frame saved while an external monitor was connected restores a window nobody can see once that
 * monitor is gone, which reads as a launch that opened nothing. The rule here is the only thing
 * standing between a state file and that window: a frame is usable when it overlaps some display's
 * work area by at least one point on each axis.
 */

/** A rectangle in one coordinate space: the frame a platform reports and applies. */
export interface FrameRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * The overlap a frame needs. One point, not a fraction: a zero-area intersection is exactly the
 * gone-monitor case, while a window hanging mostly off an edge is one the user can still grab, and
 * refusing it would undo a resize that was perfectly reachable a minute ago.
 */
export const MIN_VISIBLE_POINTS = 1;

function finite(...values: number[]): boolean {
	return values.every((value) => Number.isFinite(value));
}

/** A positive-area rectangle; anything else is a display that cannot hold a window. */
function usable(rect: FrameRect | undefined): rect is FrameRect {
	if (rect === undefined) return false;
	const { x, y, width, height } = rect;
	return finite(x, y, width, height) && width > 0 && height > 0;
}

/** The part of `frame` that lies inside `area`, as a width and a height (negative means no touch). */
export function visibleOverlap(
	frame: FrameRect,
	area: FrameRect,
): { width: number; height: number } {
	const left = Math.max(frame.x, area.x);
	const right = Math.min(frame.x + frame.width, area.x + area.width);
	const bottom = Math.max(frame.y, area.y);
	const top = Math.min(frame.y + frame.height, area.y + area.height);
	return { width: right - left, height: top - bottom };
}

/**
 * Whether `frame` can be restored: four real numbers, a positive size, and a visible overlap with
 * at least one display's work area. An empty display list rejects every frame, because a frame
 * nothing proves visible is worse than the configured size the human can find.
 */
export function restorableFrame(frame: FrameRect, workAreas: readonly FrameRect[]): boolean {
	const { x, y, width, height } = frame;
	if (!finite(x, y, width, height) || width <= 0 || height <= 0) return false;
	return workAreas.some((area) => {
		if (!usable(area)) return false;
		const overlap = visibleOverlap(frame, area);
		return overlap.width >= MIN_VISIBLE_POINTS && overlap.height >= MIN_VISIBLE_POINTS;
	});
}
