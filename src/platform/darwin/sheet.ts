import type { OpenPanelResult } from "@/plugins/dialog";
import { NS_MODAL_RESPONSE, PANEL_MAX_PATHS, SHEET_POLL_INTERVAL_MS } from "./panel-status.ts";

/**
 * The native reads a sheet poll needs, named so a test can supply them. `response()` only means anything once `done()` is true; the shim answers `SHIM_PANEL_NO_RESPONSE` (-1) before that, so "cancel" and "no answer yet" are never the same value.
 */
export interface SheetReadings {
	done(): boolean;
	response(): number;
	count(): number;
	path(index: number): string;
}

/**
 * Await a sheet already on screen, without blocking. `-runModal` stops the JavaScript thread, the Cocoa pump and every in-flight invoke for as long as the panel is up; a sheet plus this `setTimeout` poll leaves all three running, so the pump's own timer gets a turn between reads.
 * Rejections are malformed answers, never a user's choice: a response that is neither OK nor Cancel, a path count outside `0…PANEL_MAX_PATHS` (impossible from the C storage, so the read is not the one written), or an OK with an empty list or empty string — OK means "the user picked". Cancel resolves `{ paths: [] }`, never `not-implemented`. `abandoned` is the page's own cancel reaching the wait: checked before every read, so a cancelled sheet immediately replaced can never report the replacement's answer as its own.
 */
export async function awaitSheetResult(
	readings: SheetReadings,
	options: { intervalMs?: number; command?: string; abandoned?: () => boolean } = {},
): Promise<OpenPanelResult> {
	const intervalMs = options.intervalMs ?? SHEET_POLL_INTERVAL_MS;
	const command = options.command ?? "openPanel";
	if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
		throw new Error(`crust: awaitSheetResult needs a positive interval, got ${intervalMs}`);
	}

	while (!readings.done()) {
		if (options.abandoned?.() === true) return { paths: [] };
		await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
	}

	const response = readings.response();
	if (response === NS_MODAL_RESPONSE.cancel) return { paths: [] };
	if (response !== NS_MODAL_RESPONSE.ok) {
		throw new Error(
			`crust: ${command} sheet ended with NSModalResponse ${response}, which is neither ` +
				`OK (${NS_MODAL_RESPONSE.ok}) nor cancel (${NS_MODAL_RESPONSE.cancel})`,
		);
	}

	const count = readings.count();
	if (!Number.isInteger(count) || count < 0 || count > PANEL_MAX_PATHS) {
		throw new Error(
			`crust: ${command} sheet reported ${count} paths, outside 0…${PANEL_MAX_PATHS}`,
		);
	}
	if (count === 0) {
		throw new Error(`crust: ${command} sheet answered OK with no paths`);
	}

	const paths: string[] = [];
	for (let index = 0; index < count; index++) {
		const path = readings.path(index);
		if (path.length === 0) {
			throw new Error(`crust: ${command} sheet answered OK with an empty path at ${index}`);
		}
		paths.push(path);
	}
	return { paths };
}
