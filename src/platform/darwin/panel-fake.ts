import { describe, expect, test } from "bun:test";
import { NS_MODAL_RESPONSE, PANEL_KIND, PANEL_STATUS, type PanelShim } from "./index.ts";

/** `SHIM_PANEL_NO_RESPONSE` in the shim source: the sheet has not answered yet. */
export const SHIM_PANEL_NO_RESPONSE = -1;

/**
 * A stand-in for the C panel state, applying the same one-sheet rule the shim
 * applies: a sheet that is up and unanswered refuses a second request with
 * `busy` and leaves every read exactly as it was.
 *
 * This is the seam that makes the defect testable without a window. The real
 * storage lives in the shim source, so the C half of the same rule is proved by the
 * bounded windowed run; what is proved here is that the adapter honours a
 * refusal instead of reading the wrong panel's state.
 */
export class FakePanel implements PanelShim {
	/** Which class the live sheet is; `PANEL_KIND.none` with none. */
	kind: number = PANEL_KIND.none;
	done = false;
	response = SHIM_PANEL_NO_RESPONSE;
	paths: string[] = [];
	/** Sheets actually started, which is how a refusal is proved to send nothing. */
	sheets = 0;
	/** Calls that took the blocking `-runModal` fallback. */
	modalCalls = 0;
	/** When true, the sheet attempt answers `noWindow`, as a windowless app does. */
	windowless = false;

	private start(kind: number): number {
		if (this.kind !== PANEL_KIND.none && !this.done) return PANEL_STATUS.busy;
		this.kind = kind;
		this.done = false;
		this.response = SHIM_PANEL_NO_RESPONSE;
		this.paths = [];
		this.sheets++;
		return PANEL_STATUS.sheetStarted;
	}

	openPanel(_title = "", _types = "", _directory = 0, _multiple = 0, runModal = 0): number {
		// A windowless app answers `noWindow` to the sheet attempt; the adapter then
		// resends with the free-standing presentation, which reports through the poll.
		if (this.windowless && runModal === 0) return PANEL_STATUS.noWindow;
		if (runModal === 1) this.modalCalls++;
		return this.start(PANEL_KIND.open);
	}

	savePanel(): number {
		return this.start(PANEL_KIND.save);
	}

	panelCount(): number {
		return this.paths.length;
	}

	panelPath(index: number): string {
		return this.paths[index] ?? "";
	}

	sheetDone(): boolean {
		return this.done;
	}

	sheetResponse(): number {
		return this.response;
	}

	sheetCancel(): number {
		// The same guard the shim has: a sheet that already answered is not
		// something -cancel: can send to.
		if (this.kind === PANEL_KIND.none || this.done) return 0;
		this.done = true;
		this.response = NS_MODAL_RESPONSE.cancel;
		return 1;
	}

	sheetKind(): number {
		return this.done ? PANEL_KIND.none : this.kind;
	}

	/** The user answered the live sheet with a pick. */
	answer(picked: string[]): void {
		this.paths = [...picked];
		this.response = NS_MODAL_RESPONSE.ok;
		this.done = true;
	}
}
