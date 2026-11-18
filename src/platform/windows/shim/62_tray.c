// --- `crust:tray`'s menu and the icon's life ------------------------------
// One translation unit with the two parts above, so the statics there are the same objects here.
//
// The menu is built when the human right-clicks and destroyed as soon as `TrackPopupMenu` returns, so
// a `setMenu` call stores labels and nothing else. `TPM_RETURNCMD` makes the choice synchronous,
// which is what lets the click reach JavaScript as a number the adapter polls rather than a callback
// fired from inside the pump.

#define SHIM_TRAY_MAX 12
#define SHIM_LABEL_MAX 96
#define SHIM_TPM_RETURNCMD 0x0100u
#define SHIM_TPM_RIGHTBUTTON 0x0002u
#define SHIM_TPM_NONOTIFY 0x0080u
#define SHIM_MF_STRING 0x0000u
#define SHIM_WM_NULL 0x0000u

static char g_labels[SHIM_TRAY_MAX][SHIM_LABEL_MAX];
static int g_label_count;

// The hidden window's procedure. Two messages matter and everything else is DefWindowProcW's.
shim_i64 shim_tray_proc(shim_h hwnd, unsigned int msg, shim_u64 wp, shim_i64 lp) {
	if (msg == SHIM_WM_TRAY) {
		// Vista and later put the mouse message in the low word of lParam.
		unsigned int mouse = (unsigned int)lp & 0xFFFFu;
		if (mouse == SHIM_WM_RBUTTONUP || mouse == SHIM_WM_LBUTTONUP ||
		    mouse == SHIM_WM_LBUTTONDBLCLK) {
			shim_tray_menu_open(hwnd);
		}
		return 0;
	}
	if (msg == SHIM_WM_COMMAND) {
		unsigned int id = (unsigned int)wp & 0xFFFFu;
		if (id > 0 && (int)id <= g_label_count) g_click = (int)id - 1;
		return 0;
	}
	return DefWindowProcW(hwnd, msg, wp, lp);
}

// Build the popup from the stored labels and run it modally at the cursor. Returns the chosen
// one-based command id, or 0 when the human dismissed it.
int shim_tray_menu_open(shim_h hwnd) {
	if (g_label_count <= 0) {
		shim_reason_set("tray.setMenu has not stored a menu, so there is nothing to show");
		return 0;
	}
	shim_h menu = CreatePopupMenu();
	if (!menu) {
		shim_reason_set("CreatePopupMenu returned NULL");
		return 0;
	}
	shim_wchar text[SHIM_LABEL_MAX];
	for (int i = 0; i < g_label_count; i++) {
		if (shim_utf16(g_labels[i], text, SHIM_LABEL_MAX) < 0) continue;
		AppendMenuW(menu, SHIM_MF_STRING, (unsigned long long)(i + 1), text);
	}
	int point[2];
	point[0] = 0;
	point[1] = 0;
	GetCursorPos(point);
	// Both of these are required, not style: without SetForegroundWindow the menu does not dismiss
	// when the human clicks elsewhere, and the WM_NULL after it is the documented workaround for the
	// same symptom.
	SetForegroundWindow(hwnd);
	int chosen = (int)TrackPopupMenu(
	    menu, SHIM_TPM_RETURNCMD | SHIM_TPM_RIGHTBUTTON | SHIM_TPM_NONOTIFY, point[0], point[1], 0,
	    hwnd, 0);
	PostMessageW(hwnd, SHIM_WM_NULL, 0, 0);
	DestroyMenu(menu);
	if (chosen > 0 && chosen <= g_label_count) g_click = chosen - 1;
	return chosen;
}

// The labels, one per line, in the order the plugin sent them. An empty list detaches the menu.
int shim_tray_menu(const char *joined, int count) {
	if (!shim_notify_load()) return 0;
	g_label_count = 0;
	if (!joined || count <= 0) return 1;
	int index = 0;
	int i = 0;
	while (joined[i] && index < SHIM_TRAY_MAX) {
		int n = 0;
		while (joined[i] && joined[i] != '\n' && n < SHIM_LABEL_MAX - 1) {
			g_labels[index][n++] = joined[i++];
		}
		g_labels[index][n] = 0;
		while (joined[i] && joined[i] != '\n') i++; // an over-long label keeps its first 95 bytes
		if (joined[i] == '\n') i++;
		index++;
	}
	g_label_count = index;
	return 1;
}

// The hover text, which is the only place a notification-area icon can carry text at all.
int shim_tray_tooltip(const char *text) {
	if (!shim_notify_load() || !shim_icon_ensure()) return 0;
	shim_nid nid;
	shim_zero(&nid, sizeof(nid));
	nid.cbSize = (unsigned int)sizeof(nid);
	nid.hWnd = g_hwnd;
	nid.uID = SHIM_TRAY_ID;
	nid.uFlags = SHIM_NIF_TIP;
	if (shim_utf16(text, nid.szTip, 128) < 0) {
		shim_reason_set("the tooltip did not convert to UTF-16 (MultiByteToWideChar)");
		return 0;
	}
	if (!Shell_NotifyIconW(SHIM_NIM_MODIFY, &nid)) {
		shim_reason_set("Shell_NotifyIconW(NIM_MODIFY, NIF_TIP) returned FALSE");
		return 0;
	}
	shim_reason_set("the tooltip is set");
	return 1;
}

int shim_tray_show(void) {
	if (!shim_notify_load()) return 0;
	return shim_icon_ensure();
}

// `NIM_DELETE` removes the icon; the hidden window stays, so a later `show` is one call.
int shim_tray_hide(void) {
	if (!shim_notify_load()) return 0;
	if (!g_added) return 1;
	shim_nid nid;
	shim_zero(&nid, sizeof(nid));
	nid.cbSize = (unsigned int)sizeof(nid);
	nid.hWnd = g_hwnd;
	nid.uID = SHIM_TRAY_ID;
	if (!Shell_NotifyIconW(SHIM_NIM_DELETE, &nid)) {
		shim_reason_set("Shell_NotifyIconW(NIM_DELETE) returned FALSE");
		return 0;
	}
	g_added = 0;
	return 1;
}

// The icon and the window both go: after this the adapter holds nothing, and a `show` builds again.
int shim_tray_destroy(void) {
	if (!shim_notify_load()) return 0;
	int ok = shim_tray_hide();
	if (g_hwnd) {
		DestroyWindow(g_hwnd);
		g_hwnd = 0;
	}
	g_label_count = 0;
	g_click = -1;
	return ok;
}
