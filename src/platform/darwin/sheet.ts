import type { OpenPanelResult } from "@/plugins/dialog";
import { NS_MODAL_RESPONSE, PANEL_MAX_PATHS, SHEET_POLL_INTERVAL_MS } from "./panel-status.ts";

/**
 * The native reads a sheet poll needs, named so a test can supply them.
 *
 * `response()` only means anything once `done()` is true; the shim answers
 * `SHIM_PANEL_NO_RESPONSE` (-1) before that, so "cancel" and "no answer yet"
 * are never the same value.
 */
export interface SheetReadings {
	done(): boolean;
	response(): number;
	count(): number;
	path(index: number): string;
}

/**
 * Await a sheet that is already on screen, without blocking.
 *
 * This is the half that makes the sheet path real. `-runModal` stops the
 * JavaScript thread, and with it the Cocoa pump and every in-flight invoke, for
 * as long as the panel is up; a sheet plus this poll leaves both running. The
 * await is a `setTimeout` chain, so the pump's own timer gets its turn between
 * reads.
 *
 * Rejections are the malformed answers, never a user's choice:
 *
 *   - a response that is neither `NSModalResponseOK` nor `NSModalResponseCancel`
 *     (a panel that reports something else is not something to guess about);
 *   - a path count outside `0…PANEL_MAX_PATHS`, which cannot come from the C
 *     storage and means the read is not the one that was written;
 *   - an OK whose path list is empty, or contains an empty string, because OK
 *     means "the user picked" and an empty answer contradicts it.
 *
 * Cancel resolves `{ paths: [] }`, which is exactly what a user clicking Cancel
 * means — the two are never confused, and neither is ever `not-implemented`.
 *
 * `abandoned` is the page's own cancel reaching the wait: once it answers true
 * the poll stops reading and resolves the same empty list, instead of reading
 * state the *next* request has already reset. The check comes before every
 * read, so a sheet that is cancelled and immediately replaced can never report
 * the replacement's answer as its own.
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
