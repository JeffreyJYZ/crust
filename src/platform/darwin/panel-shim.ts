import type { OpenPanelOptions } from "@/plugins/dialog";
import { shim } from "./index.ts";
import { cstr } from "./objc.ts";
import type { SheetReadings } from "./sheet.ts";

/** Filters as one comma-separated extension list — the only shape C can take. */
export function extensionList(filters: OpenPanelOptions["filters"]): string {
	if (!filters) return "";
	const seen = new Set<string>();
	for (const filter of filters) {
		for (const raw of filter.extensions) {
			const ext = raw
				.trim()
				.replace(/^\*?\.?/, "")
				.toLowerCase();
			if (ext.length > 0) seen.add(ext);
		}
	}
	return [...seen].join(",");
}

/**
 * The panel half of the compiled shim, named so a test can drive the adapter
 * with a fake and wide enough that the real one is the same shape.
 *
 * Every method binds `shim()` when it is called, not when this object is built,
 * so the C file still compiles on the first pick rather than at import.
 */
export interface PanelShim {
	openPanel(
		title: string,
		types: string,
		directories: number,
		multiple: number,
		runModal: number,
	): number;
	savePanel(title: string, suggestedName: string, types: string, runModal: number): number;
	panelCount(): number;
	panelPath(index: number): string;
	sheetDone(): boolean;
	sheetResponse(): number;
	sheetCancel(): number;
	sheetKind(): number;
}

/** The real panel shim: one call per method, C string buffers built here. */
export function darwinPanelShim(): PanelShim {
	return {
		openPanel: (title, types, directories, multiple, runModal) =>
			Number(
				shim().symbols.shim_open_panel(
					cstr(title),
					cstr(types),
					directories,
					multiple,
					runModal,
				) ?? -1,
			),
		savePanel: (title, suggestedName, types, runModal) =>
			Number(
				shim().symbols.shim_save_panel(
					cstr(title),
					cstr(suggestedName),
					cstr(types),
					runModal,
				) ?? -1,
			),
		panelCount: () => Number(shim().symbols.shim_open_panel_count() ?? 0),
		panelPath: (index: number) => String(shim().symbols.shim_open_panel_path(index) ?? ""),
		sheetDone: () => Number(shim().symbols.shim_sheet_done() ?? 0) === 1,
		sheetResponse: () => Number(shim().symbols.shim_sheet_response() ?? -1),
		sheetCancel: () => Number(shim().symbols.shim_sheet_cancel() ?? 0),
		sheetKind: () => Number(shim().symbols.shim_sheet_kind() ?? 0),
	};
}

/** The native reads `awaitSheetResult` polls. */
export function sheetReadings(native: PanelShim): SheetReadings {
	return {
		done: () => native.sheetDone(),
		response: () => native.sheetResponse(),
		count: () => native.panelCount(),
		path: (index: number) => native.panelPath(index),
	};
}
