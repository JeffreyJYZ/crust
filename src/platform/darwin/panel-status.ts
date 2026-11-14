/**
 * What `shim_open_panel` returns. Mirrors the `SHIM_PANEL_*` defines in
 * the shim source; the shim guards every selector itself and reports an absent one as
 * `unsupported` rather than sending it and aborting the process.
 */
export const PANEL_STATUS = {
	/** A pick finished with at least one path. */
	picked: 0,
	/** A pick finished with no path — the user cancelled. */
	cancelled: 1,
	/** `NSOpenPanel`, or a selector it needs, is absent on this system. */
	unsupported: 2,
	/** The sheet is on screen: poll `shim_sheet_done` until it answers. */
	sheetStarted: 3,
	/** A sheet was asked for with no key window; nothing was sent. */
	noWindow: 4,
	/**
	 * A sheet is already up; nothing was sent and the live sheet was left
	 * untouched. The page answers or cancels that one first — `dialog.cancel`
	 * is the page-level cancel — because the C side holds exactly one panel's
	 * state.
	 */
	busy: 5,
} as const;

/**
 * What `shim_sheet_kind` answers: the class of the sheet that is up, which is
 * what lets a refusal name the panel instead of saying "busy".
 */
export const PANEL_KIND = {
	none: 0,
	open: 1,
	save: 2,
} as const;

/** `NSModalResponse`, the value the sheet's completion handler records. */
export const NS_MODAL_RESPONSE = {
	ok: 1,
	cancel: 0,
} as const;

/** Mirrors `SHIM_PANEL_MAX_PATHS`: the most paths one pick can store. */
export const PANEL_MAX_PATHS = 32;

/**
 * How often the sheet's done flag is read. One frame at 60 Hz: a 300 ms pick
 * costs ~19 reads, and the promise settles on the next frame after the click.
 * A timer, not a loop, is the point — every wait yields, so the app's own pump
 * keeps running and the bridge keeps answering invokes while the sheet is up.
 */
export const SHEET_POLL_INTERVAL_MS = 16;
/**
 * How long `dialog.cancel` waits for the sheet's completion handler after
 * `-cancel:` was sent. The dismissal animation is a fraction of a second; two
 * seconds is a hang, not a slow window, and answering "cancelled" before the
 * handler ran would let the next request reset state the sheet still owns.
 */
export const SHEET_CANCEL_TIMEOUT_MS = 2000;

/**
 * The refusal a `busy` status becomes. Pure so the message is asserted without a window: it must name the panel already up, because "busy" alone tells a page nothing actionable, and the way out, because the page's only other option is a human.
 */
export function busyRefusal(command: string, kind: number): string {
	const up =
		kind === PANEL_KIND.open
			? "an NSOpenPanel sheet is already up"
			: kind === PANEL_KIND.save
				? "an NSSavePanel sheet is already up"
				: "a sheet is already up";
	const cls = command === "savePanel" ? "NSSavePanel" : "NSOpenPanel";
	return (
		`crust: ${command} refused (busy); ${up}, and only one panel can be open at a time — ` +
		`answer it, or call dialog.cancel, before asking ${cls} for another`
	);
}
