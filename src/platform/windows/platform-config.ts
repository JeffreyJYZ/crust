/**
 * The Windows platform's configuration, plus the two small rules that keep `platform.ts` the class
 * it is: a URL a browser can be handed, and an HRESULT as the hex a Windows developer recognises.
 */

/** A window with no configured size. The darwin default, so one config reads the same on both. */
export const DEFAULT_WIDTH = 1100;
export const DEFAULT_HEIGHT = 760;

export interface WindowsPlatformConfig {
	/** Registered as the window class and named in every failure. */
	appName?: string;
	/** WebView2's user-data folder; empty lets WebView2 pick its own default. */
	userDataDir?: string;
}

/**
 * A URL a browser can be handed: an absolute one, or `about:blank` for a relative path. A relative
 * URL needs the bridge server, which the platform does not own.
 */
export function absoluteUrl(url: string): string {
	return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) ? url : "about:blank";
}

/** An HRESULT as the hex a Windows developer recognises. */
export function hresult(value: number): string {
	return `0x${(value >>> 0).toString(16)}`;
}
