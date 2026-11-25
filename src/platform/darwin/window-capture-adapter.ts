/**
 * The labelled half of `window.capture`: map a label to its `WKWebView *` and hand it to the
 * snapshot promise. Kept apart from the labelled adapter for the same reason the state half is, so
 * the rule that is not WebKit's — an unknown label refuses instead of acting on another window —
 * is testable with the picture replaced by a double.
 */

import type { WindowCaptureNative, WindowCaptureOptions } from "@/plugins/window";
import { type SnapshotShim, takeSnapshot } from "./snapshot.ts";

export function windowCaptureAdapter(
	/** The label's own webview; throws for a label this platform cannot resolve. */
	require: (label: string) => number,
	/** The byte seam, overridable so the labelled rule is proved without WebKit. */
	shim?: SnapshotShim,
): WindowCaptureNative {
	return {
		capture: (label, options?: WindowCaptureOptions) =>
			takeSnapshot(require(label), shim, undefined, options),
	};
}
