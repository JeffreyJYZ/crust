int shim_sheet_done(void) { return panel_sheet_done; }

// The NSModalResponse the sheet ended with: 1 is NSModalResponseOK and 0 is a
// cancel. SHIM_PANEL_NO_RESPONSE (-1) means it has not ended yet, so a caller
// that reads 0 can never confuse "cancel" with "no answer".
long long shim_sheet_response(void) { return panel_sheet_response; }

// End the live sheet without a human: -cancel: is the panel's own cancel action, so it runs the same path as
// clicking Cancel — handler fires, response recorded, sheet leaves. Returns 1 when the send happened, 0 when
// no sheet is up (or already answered) or the selector is absent, so a page calling twice cannot end a second
// sheet. The page-level cancel behind `dialog.cancel`, and the way out of a sheet opened by accident.
int shim_sheet_cancel(void) {
	obj_t panel = panel_sheet_panel;
	if (!panel || panel_sheet_done) return 0;
	const char *clsname = panel_sheet_is_save ? "NSSavePanel" : "NSOpenPanel";
	if (!panel_has_instance(clsname, "cancel:")) return 0;
	((void (*)(void *, void *))objc_msgSend)(panel, sel_registerName("cancel:"));
	return 1;
}

// Which class the live sheet is, so a refusal can name the panel that is
// already up instead of saying "busy": 1 for NSOpenPanel, 2 for NSSavePanel, 0
// when no sheet is waiting for an answer. A finished sheet is not blocking
// anybody, so it reads 0 — the same rule panel_sheet_busy() applies.
int shim_sheet_kind(void) {
	if (!panel_sheet_busy()) return 0;
	return panel_sheet_is_save ? 2 : 1;
}
