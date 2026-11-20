/**
 * The macOS media-capture grant, decided per webview by a UI delegate.
 *
 * `getUserMedia` itself needs no configuration on this platform: `WKWebViewConfiguration` exposes
 * no capture switch publicly, `WKUIDelegate.h` documents that an unimplemented
 * `-webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:` behaves
 * as `WKPermissionDecisionPrompt`, and `WKWebView`'s own `cameraCaptureState` /
 * `microphoneCaptureState` are macOS 12+ public API. The private `_mediaCaptureEnabled` preference
 * that pre-12 embedders toggled has no public equivalent and is not needed at crust's 13.0 floor,
 * so nothing here sends a private selector.
 *
 * What crust adds is the decision: grant a microphone request only when `security.microphone` is
 * configured, and deny everything else — including camera and camera+microphone — before it can
 * reach a TCC prompt this bundle has no purpose string for. A TCC request without that string
 * terminates the process, so denying is the safe answer, not a limitation. `crust dev` runs
 * unbundled and therefore denies too: it has no `Info.plist` for macOS to read, so a grant there
 * would end in TCC killing the dev process instead of asking.
 */
import { mediaCaptureUnit } from "./media-capture-ffi.ts";

/** `shim_media_capture_install`'s answers. */
export const MEDIA_CAPTURE_STATUS = {
	installed: 0,
	/** No webview, or a WKWebView without `-setUIDelegate:`. */
	missing: 1,
	/** The delegate class could not be built at runtime. */
	unavailable: 3,
	/** This webview already carries a delegate this unit installed. */
	already: 4,
	/** Another `uiDelegate` was already attached; crust never clobbers one. */
	occupied: 5,
} as const;

export type MediaCaptureStatus = (typeof MEDIA_CAPTURE_STATUS)[keyof typeof MEDIA_CAPTURE_STATUS];

/** Install (or reuse) the capture delegate. `grant` is the `security.microphone` opt-in. */
export function installMediaCapture(web: number, grant: boolean): MediaCaptureStatus {
	if (!web) return MEDIA_CAPTURE_STATUS.missing;
	const raw = mediaCaptureUnit().symbols.shim_media_capture_install(web, grant ? 1 : 0);
	return Number(raw ?? MEDIA_CAPTURE_STATUS.missing) as MediaCaptureStatus;
}

/** Read the attachment back from the webview, rather than trusting an earlier status code. */
export function mediaCaptureInstalled(web: number): boolean {
	if (!web) return false;
	return Number(mediaCaptureUnit().symbols.shim_media_capture_installed(web) ?? 0) === 1;
}

/**
 * The window-creation entry point. Every window gets the delegate, so an app that never opted in
 * denies a capture request instead of letting WebKit ask TCC for a microphone it declared no
 * purpose for — that request terminates the process. A configured app throws here if the delegate
 * did not attach, because it would otherwise ship a microphone that silently never works.
 */
export function installWindowMediaCapture(web: number, microphone: boolean): void {
	const status = installMediaCapture(web, microphone);
	if (!microphone) return;
	if (status === MEDIA_CAPTURE_STATUS.installed || status === MEDIA_CAPTURE_STATUS.already)
		return;
	throw new Error(
		`media capture: the WKWebView UI delegate could not be installed (status ${status}) — ` +
			"security.microphone needs a webview whose -UIDelegate is free",
	);
}
