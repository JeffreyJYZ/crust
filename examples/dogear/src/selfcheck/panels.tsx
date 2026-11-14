/**
 * Steps 9–10: the two file panels, and the one panel answer a scripted run can
 * produce.
 *
 * `dialog.openPanel` and `dialog.savePanel` each start an AppKit sheet, and only
 * a human can complete a *pick*. Step 10 cancels the folder sheet step 9 left up
 * — the page's own Cancel button is the one answer a scripted run can give — and
 * the save panel is left up, because there is no such way to answer it. Nothing
 * here writes a path the save panel answered with.
 */
import { describe, plugin } from "../bridge";
import { MARKDOWN_FILTERS, suggestedName } from "../notes";
import type { Checks } from "./checks";
import { settle } from "./checks";
import type { ListEntry } from "./steps";

export async function runPanelSteps(checks: Checks, note: ListEntry): Promise<void> {
	const { pass, fail } = checks;

	// 9. The folder picker. A pick needs a human, so a sheet that is still up
	//    after a second and a half is the pass. The invoke is kept rather than
	//    dropped: step 10 cancels it, and that cancel has to be what answers it,
	//    so a non-null value here means "this run left a sheet up".
	let folderRun: Promise<{ paths: string[] }> | null = null;
	try {
		const pick = plugin<{ paths: string[] }>("dialog", "openPanel", {
			title: "Choose a folder of markdown notes",
			directory: true,
		});
		const raced = await settle(pick, 1500);
		if (!raced.done) {
			folderRun = pick;
			pass("dialog sheet", "NSOpenPanel is up; a pick needs a human, so it stays pending");
		} else {
			const picked = raced.value.paths[0];
			pass(
				"dialog sheet",
				picked === undefined
					? "NSOpenPanel answered with no path (cancelled)"
					: `NSOpenPanel answered ${picked}`,
			);
		}
	} catch (error) {
		fail("dialog sheet", describe(error));
	}

	// 10. The page's own cancel, then the save panel.
	//
	//     `dialog.cancel` is the way out of a sheet no human answered, and its
	//     own answer is not the evidence: the folder pick step 9 started has to
	//     resolve as cancelled, with no path, so a cancel that reported success
	//     while leaving the invoke pending fails here — and so does one that
	//     reports nothing pending while step 9's sheet is still up. Nothing is
	//     written either way. Then the save panel, asked the way the Save as…
	//     button asks it — one sheet at a time, so the folder one is gone first —
	//     and it stays up like the folder sheet did, because a pick needs a human.
	try {
		const cleared = await plugin<{ cancelled: boolean }>("dialog", "cancel", {});
		let cancelNote =
			"the folder sheet had already been answered, so there was nothing to cancel";
		if (folderRun !== null) {
			if (!cleared.cancelled) {
				throw new Error(
					"dialog.cancel reported nothing pending while the folder sheet from step 9 was up",
				);
			}
			const answered = await settle(folderRun, 1500);
			if (!answered.done) {
				throw new Error(
					"dialog.cancel answered cancelled but the folder pick never resolved",
				);
			}
			const paths = answered.value.paths ?? [];
			if (paths.length !== 0) {
				throw new Error(
					`dialog.cancel answered cancelled but the folder pick resolved ${paths.join(", ")}`,
				);
			}
			cancelNote =
				"the folder sheet was cancelled by the page and its pending invoke resolved with no path";
		}
		const panel = plugin<{ paths: string[] }>("dialog", "savePanel", {
			title: "Save a copy of the note",
			suggestedName: suggestedName(note.name),
			filters: MARKDOWN_FILTERS,
		});
		const raced = await settle(panel, 1500);
		if (!raced.done) {
			pass(
				"save panel",
				`NSSavePanel is up; ${cancelNote}; a pick needs a human, so this one stays pending`,
			);
		} else {
			const picked = raced.value.paths[0];
			pass(
				"save panel",
				picked === undefined
					? `NSSavePanel answered with no path (cancelled); ${cancelNote}; nothing was written`
					: `NSSavePanel answered ${picked}; ${cancelNote}; the check wrote nothing`,
			);
		}
	} catch (error) {
		fail("save panel", describe(error));
	}
}
