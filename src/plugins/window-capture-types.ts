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
}

export interface WindowCaptureArgs {
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
	capture?(label: string): Promise<WindowSnapshot>;
}
