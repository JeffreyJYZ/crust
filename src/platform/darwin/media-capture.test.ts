/**
 * The capture delegate on a real `WKWebView`, built from the app's own configuration but never
 * placed in a window, so this suite opens nothing on a machine someone is using.
 *
 * No private selector is sent: the supported systems expose the capture permission through
 * `WKUIDelegate` (macOS 12+), which is why the source must not mention the pre-12
 * `_mediaCaptureEnabled` preference. That absence is asserted, because a future "fix" that
 * reaches for SPI would be the defect.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { shim } from "./index.ts";
import {
	installMediaCapture,
	MEDIA_CAPTURE_STATUS,
	mediaCaptureInstalled,
} from "./media-capture.ts";
import { webviewConfiguration } from "./webview-configuration.ts";

const captured = (): number =>
	Number(shim().symbols.shim_webview_new(webviewConfiguration(), 0, 0) ?? 0);

describe("media capture delegate", () => {
	test("a null webview is refused, not sent to", () => {
		expect(installMediaCapture(0, true)).toBe(MEDIA_CAPTURE_STATUS.missing);
		expect(mediaCaptureInstalled(0)).toBe(false);
	});

	test("installs on a real WKWebView and reads the attachment back", () => {
		const web = captured();
		expect(web).toBeGreaterThan(0);
		expect(installMediaCapture(web, true)).toBe(MEDIA_CAPTURE_STATUS.installed);
		expect(mediaCaptureInstalled(web)).toBe(true);
		// A second install finds its own delegate instead of stacking another class.
		expect(installMediaCapture(web, false)).toBe(MEDIA_CAPTURE_STATUS.already);
	});

	test("the C unit registers the public capture delegate selector", () => {
		const source = readFileSync(join(import.meta.dir, "shim/122_media_capture.c"), "utf8");
		expect(source).toContain("requestMediaCapturePermissionForOrigin");
		expect(source).toContain("setUIDelegate:");
		// Pre-macOS 12 embedders toggled this private preference; it is not needed on 13.0+.
		expect(source).not.toContain("_mediaCaptureEnabled");
		// `crust dev` is unbundled: granting there would have TCC kill the process for a
		// missing purpose string, so the decision also asks whether a bundle exists.
		expect(source).toContain("bundleIdentifier");
	});
});
