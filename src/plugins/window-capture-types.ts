/**
 * `crust:window`'s capture vocabulary: one label in, one PNG of the page as the webview rendered
 * it out. Split out of `window-types.ts` for the cap, and re-exported there so the contract stays
 * one import.
 * This is a `WKWebView` render, never the display: no Screen Recording grant is involved and
 * `CGWindowListCreateImage` is never called, which is also why a platform without the API answers
 * `not-implemented` rather than falling back to a screenshot of the screen.
 */

/** The page as the webview rendered it, sized in page pixels at the window's scale factor. */
export interface WindowSnapshot {
	/** Bitmap width in page pixels: the point width times the display's scale factor. */
	readonly width: number;
	/** Bitmap height in page pixels. */
	readonly height: number;
	/** Bitmap pixels per point, as the platform measured it: 2 on a Retina display. */
	readonly scale: number;
	/** base64 of the PNG bytes, with no `data:` prefix. */
	readonly png: string;
	/**
	 * Platform fact, not a page input: the finished bitmap has one distinct colour and zero
	 * differing pixels. Absent when the platform cannot measure it (another platform, or a fake).
	 * Pixels alone never decide a refusal — see `composited`.
	 */
	readonly flat?: boolean;
	/**
	 * Platform fact read at capture time: AppKit's composited bit on this view's window. Absent
	 * when the platform cannot report it. `flat: true` plus `composited: false` is the
	 * never-composited state; a flat picture from a composited page is still a picture.
	 */
	readonly composited?: boolean;
}

/**
 * The probe-only opt-ins. `ignoreOcclusion` asks for a picture of a view WebKit considers occluded;
 * `prime` forces AppKit's composited bit on a view that never drew. Both say what the caller wants,
 * not the private selectors that deliver them. Absent is the ordinary capture. `prime` is
 * harness-only and refused in a shipped bundle.
 */
export interface WindowCaptureOptions {
	readonly ignoreOcclusion?: boolean;
	/** HARNESS ONLY. See `SnapshotOptions.prime`; a shipped app should show its window instead. */
	readonly prime?: boolean;
}

export interface WindowCaptureArgs extends WindowCaptureOptions {
	label: string;
}

export interface WindowCaptureResult extends WindowSnapshot {
	readonly ok: true;
	readonly label: string;
}

/**
 * The capture half of the native contract, optional on the same rule the state and chrome halves
 * set: an adapter written before this command existed still satisfies `WindowNative`, and a missing
 * member answers `not-implemented` naming the API it would need. Async because the webview hands the
 * picture to a completion handler, so the answer arrives after the send.
 */
export interface WindowCaptureNative {
	capture?(label: string, options?: WindowCaptureOptions): Promise<WindowSnapshot>;
}
