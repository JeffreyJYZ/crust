// --- the pointer ------------------------------------------------------------
// `SetCursor` sets the cursor for the calling thread, and the window procedure re-applies it on
// WM_SETCURSOR — without that the next mouse move resets it to the class arrow, which would be the
// silent no-op this member used to refuse rather than ship.
//
// `ShowCursor` is a *count*, not a boolean: each call adds or subtracts one and answers the new
// count, and the pointer is visible while the count is >= 0. `shim_cursor_show` drives the count to
// the side asked for and answers it, so the adapter can refuse a call that did not get there instead
// of pretending a boolean round-trips.

// The cursor this process asked for, and the kind it came from. `0` means "no shape was ever set",
// which is the class arrow and needs no re-apply.
static shim_h g_cursor;

// Called from `20_class.c`'s WM_SETCURSOR. 1 means the cursor was set here, so the procedure answers
// TRUE instead of letting `DefWindowProcW` restore the class arrow.
int shim_cursor_apply(void) {
	if (!g_cursor) return 0;
	SetCursor(g_cursor);
	return 1;
}

// One of the five names `WINDOW_CURSORS` carries, as a number: 0 default, 1 pointer, 2 crosshair,
// 3 text, 4 grab. 0 is returned for a kind outside that range and for a `LoadCursorW` that refused
// the constant, because both are a cursor that was not set.
int shim_cursor_set(int kind) {
	if (!shim_win32_load()) return 0;
	if (kind == 0) g_cursor = LoadCursorW(0, SHIM_IDC_ARROW);
	else if (kind == 1) g_cursor = LoadCursorW(0, SHIM_IDC_HAND);
	else if (kind == 2) g_cursor = LoadCursorW(0, SHIM_IDC_CROSS);
	else if (kind == 3) g_cursor = LoadCursorW(0, SHIM_IDC_IBEAM);
	else if (kind == 4) g_cursor = LoadCursorW(0, SHIM_IDC_SIZEALL);
	else return 0;
	if (!g_cursor) return 0;
	SetCursor(g_cursor);
	return 1;
}

// Show or hide the pointer and answer the count that resulted. A count already on the wanted side is
// left alone, so two `visible: true` calls do not leave the count at +2 where one hide cannot undo it.
int shim_cursor_show(int visible) {
	int count;
	int guard = 0;
	if (!shim_win32_load()) return 0;
	count = ShowCursor(visible ? 1 : 0);
	while (guard++ < 64 && ((visible && count < 0) || (!visible && count >= 0)))
		count = ShowCursor(visible ? 1 : 0);
	return count;
}
