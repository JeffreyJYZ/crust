/**
 * `window.capture`: a label in, the page's own render out as base64 PNG.
 * The chain is the one `window-chrome.ts` and `window-state.ts` run — adapter, member, label, then
 * the platform — with one difference that is the whole point of the command: an adapter with no
 * `capture` is not a stale adapter but a platform whose webview cannot render a picture, so it
 * answers `not-implemented` naming the API rather than `unknown-adapter`. That keeps a caller's
 * branch honest on Linux and Windows, where the answer is never a silent success.
 */

import { notImplemented, type NotImplemented } from "./define";
import type {
	WindowCaptureArgs,
	WindowCaptureOptions,
	WindowCaptureResult,
	WindowSnapshot,
} from "./window-capture-types.ts";
import { failure, invalidLabel, knownWindow, readLabel } from "./window-args.ts";
import type { WindowFailure, WindowNative } from "./window-types.ts";

/** The API a platform needs before it can render a page into a bitmap. */
export const WINDOW_CAPTURE_REQUIRES =
	"-[WKWebView takeSnapshotWithConfiguration:completionHandler:]";

/** The refusal a platform without that API gives, naming it. */
export function missingCapture(): NotImplemented {
	return notImplemented(
		"window.capture renders the page with the webview itself, which this platform does not " +
			`expose. It needs ${WINDOW_CAPTURE_REQUIRES}; on macOS darwinWindowAdapter(platform) ` +
			"supplies it from window-capture-adapter.ts. It never captures the display, because " +
			"that would need Screen Recording and would not be the page either.",
		WINDOW_CAPTURE_REQUIRES,
	);
}

/** Build the capture command for one adapter; the plugin spreads it in. */
export function windowCaptureCommands(adapter?: WindowNative) {
	return {
		capture: async (
			args: WindowCaptureArgs,
		): Promise<WindowCaptureResult | WindowFailure | NotImplemented> => {
			if (!adapter) return missingCapture();
			const native = adapter;
			if (typeof native.capture !== "function") return missingCapture();
			const label = readLabel(args);
			if (label === undefined) return invalidLabel(args);
			const unknown = knownWindow(native, label);
			if (unknown) return unknown;
			const options = readCaptureOptions(args, label);
			if ("ok" in options) return options;
			try {
				const snapshot = await native.capture(label, options);
				const shape = readSnapshot(snapshot);
				if (shape === undefined) {
					return {
						ok: false,
						code: "handler-error",
						message:
							`crust: window.capture got no { width, height, scale, png } back for ` +
							`${JSON.stringify(label)}`,
						label,
					};
				}
				return { ok: true as const, label, ...shape };
			} catch (error) {
				return failure(error, label);
			}
		},
	};
}

export type WindowCaptureCommands = ReturnType<typeof windowCaptureCommands>;

/**
 * Read the probe opt-in without coercing it: a truthy `"false"` must not silently disable an app's
 * occlusion behaviour. Absent gives an empty object, so an ordinary capture sends no option at all.
 */
function readCaptureOptions(
	args: WindowCaptureArgs,
	label: string,
): WindowCaptureOptions | WindowFailure {
	const value = args.ignoreOcclusion;
	if (value === undefined) return {};
	if (typeof value === "boolean") return { ignoreOcclusion: value };
	return {
		ok: false,
		code: "invalid-value",
		message:
			"crust: window.capture ignoreOcclusion must be a boolean when given, got " +
			`${JSON.stringify(value)}`,
		label,
	};
}

/** A platform answer checked before it reaches the page: base64 text and three finite numbers. */
function readSnapshot(value: unknown): WindowSnapshot | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const { width, height, scale, png } = value as Partial<WindowSnapshot>;
	if (typeof png !== "string" || png.length === 0) return undefined;
	for (const number of [width, height, scale]) {
		if (typeof number !== "number" || !Number.isFinite(number) || number <= 0) return undefined;
	}
	return { width: width as number, height: height as number, scale: scale as number, png };
}
