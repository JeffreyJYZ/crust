/**
 * Evidence probe: is the crust tray status item actually *drawn* on the menu
 * bar, or does it only exist as an AppKit object that reports success?
 *
 * The README says nobody has seen it — an earlier run landed on a fullscreen
 * space where the menu bar is hidden. So this run answers one question with
 * pixels instead of a return value:
 *
 *   1. bring AppKit up the way `startApp` does (NSApplicationLoad →
 *      sharedApplication → activation policy) and pump it on a 16 ms timer, so
 *      the item is created inside a real, drawing application;
 *   2. capture the menu-bar strip *before* the item exists, then again with a
 *      distinctive title up, then hidden, then re-shown, then destroyed;
 *   3. read the item back from AppKit and the WindowServer — the applied title,
 *      `isVisible`, `length`, and the button window's frame, `isVisible`,
 *      `isOnActiveSpace` and `occlusionState` — and capture that window's own
 *      rectangle as well, so its pixels are compared in place;
 *   4. decode each capture (BMP, so no image library is needed) and report the
 *      pixels that changed, as a bounding box in points plus how bright the
 *      "after" pixels are inside it.
 *
 * The split matters. The readback is AppKit's *claim* about layout; the
 * screenshot is what the screen shows. When they disagree — a fullscreen space
 * keeps `isVisible = true` while the bar is off-screen — that disagreement is
 * the result, and it is reported as disagreement, not resolved by guessing.
 *
 * What it cannot do, by design: click, type, move the pointer or otherwise
 * drive the UI. A screenshot is a read. Nothing is left running: the item is
 * destroyed, the pump is stopped and the process exits.
 *
 *   bun run scripts/probe-tray.ts
 *
 * Exit status is 0 whenever the measurements themselves ran, including when the
 * item turned out to be invisible; the report says which answer it found.
 *
 * The measurement code lives beside this entry: `tray/bitmap.ts` decodes what
 * `screencapture` wrote, `tray/capture.ts` takes the captures, and
 * `tray/analysis.ts` compares them. Only the run and its JSON report are here.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPlatform } from "@/platform/darwin/index.ts";
import { createStatusBar, type StatusBarReadback } from "@/platform/darwin/status-bar.ts";
import { clusters, inPoints, measured, screenRect, stats } from "./tray/analysis.ts";
import { capture, desktopBounds, regionOf, setScreen } from "./tray/capture.ts";
import { DIR, OCCLUSION_VISIBLE, STRIP_HEIGHT, TITLE } from "./tray/constants.ts";

async function main(): Promise<void> {
	mkdirSync(DIR, { recursive: true });

	const bounds = desktopBounds();
	setScreen(bounds);
	const strip = `${bounds.x},${bounds.y},${bounds.w},${STRIP_HEIGHT}`;

	const platform = createPlatform({ appName: "crust tray probe" });
	await platform.start();
	platform.pump(16);
	await Bun.sleep(300);

	const baseline = capture("00-baseline", strip);
	if (baseline.bitmap === null) {
		platform.stopPump();
		report({
			title: TITLE,
			region: strip,
			captureAvailable: false,
			captureError: baseline.error,
			conclusion: "screen capture is unavailable to this process; pixels prove nothing",
		});
		return;
	}

	const scale = baseline.bitmap.width / STRIP_HEIGHT > 0 ? baseline.bitmap.width / bounds.w : 0;
	const barHeight = baseline.bitmap.height / scale;
	const barBand = { from: 0, to: Math.round(barHeight * 0.62) };

	const bar = createStatusBar();
	bar.setTitle(TITLE);
	bar.show();
	await Bun.sleep(700);

	const readback: StatusBarReadback = bar.readback();
	const shown = capture("01-shown", strip);
	const itemRegion = readback.frame === null ? null : regionOf(frameToTopLeft(readback.frame));
	const itemShown = itemRegion === null ? null : capture("02-item-shown", itemRegion);

	const windowShot =
		readback.windowNumber > 0
			? capture("03-button-window", null, ["-l", String(readback.windowNumber)])
			: { name: "03-button-window", bitmap: null, error: "no button window number" };

	bar.hide();
	await Bun.sleep(500);
	const hidden = capture("04-hidden", strip);

	bar.show();
	await Bun.sleep(500);
	const reshown = capture("05-reshown", strip);

	bar.destroy();
	await Bun.sleep(600);
	const gone = capture("06-gone", strip);
	const itemGone = itemRegion === null ? null : capture("07-item-gone", itemRegion);
	platform.stopPump();

	const differences: Record<string, unknown> = {};
	if (shown.bitmap) {
		differences["baseline to shown"] = {
			clusters: clusters(baseline.bitmap, shown.bitmap).map((one) => inPoints(one, scale)),
		};
	}
	if (hidden.bitmap && shown.bitmap) {
		differences["shown to hidden"] = {
			clusters: clusters(shown.bitmap, hidden.bitmap).map((one) => inPoints(one, scale)),
		};
	}
	if (reshown.bitmap) {
		differences["baseline to re-shown"] = {
			clusters: clusters(baseline.bitmap, reshown.bitmap).map((one) => inPoints(one, scale)),
		};
	}
	if (gone.bitmap) {
		differences["baseline to destroyed"] = {
			clusters: clusters(baseline.bitmap, gone.bitmap).map((one) => inPoints(one, scale)),
		};
	}
	if (itemShown?.bitmap && itemGone?.bitmap) {
		const inside = clusters(itemShown.bitmap, itemGone.bitmap, 20);
		differences["item-rect shown to destroyed"] = {
			region: itemRegion,
			changedPixels: inside.reduce((sum, one) => sum + one.pixels, 0),
			clusters: inside.map((one) => inPoints(one, scale)),
		};
	}

	report({
		title: TITLE,
		region: strip,
		screen: bounds,
		scale,
		captureAvailable: true,
		// A drawn menu bar has text in its top band; a fullscreen window does not.
		menuBarBandBrightPixels: stats(baseline.bitmap, barBand).bright,
		readback,
		frameTopLeft: readback.frame === null ? null : frameToTopLeft(readback.frame),
		itemRegion,
		captures: {
			baseline: measured(baseline, scale),
			shown: measured(shown, scale),
			hidden: measured(hidden, scale),
			"item-shown": itemShown === null ? "no frame to crop" : measured(itemShown, scale),
			"item-gone": itemGone === null ? "no frame to crop" : measured(itemGone, scale),
			"button-window": measured(windowShot, scale),
		},
		differences,
		occlusionVisible:
			readback.occlusion === null ? null : readback.occlusion === OCCLUSION_VISIBLE,
	});
}

/** AppKit frames have a bottom-left origin; `-R` wants a top-left one. */
function frameToTopLeft(frame: { x: number; y: number; width: number; height: number }): {
	x: number;
	y: number;
	width: number;
	height: number;
} {
	const screen = screenRect();
	return {
		x: frame.x,
		y: screen.h - (frame.y + frame.height),
		width: frame.width,
		height: frame.height,
	};
}

function report(payload: Record<string, unknown>): void {
	const text = JSON.stringify(payload, null, "\t");
	writeFileSync(join(DIR, "report.json"), `${text}\n`);
	process.stdout.write(`${text}\n`);
}

await main();
