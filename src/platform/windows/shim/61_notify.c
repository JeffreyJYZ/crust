// --- the notification area icon, and the balloon it carries -----------------
// One translation unit with `60_notify_tray.c`, so its statics (`g_hwnd`, `g_added`, `g_click`,
// `g_reason`) are the same objects here. The icon is created once and shared: `crust:tray` shows it,
// and a balloon is attached to it, so a machine with no notification area has no notification path
// at all — which is the status this part reports rather than a silent no-op.

// The hidden window that receives the notification area's callbacks. A normal window with no
// WS_VISIBLE, on the calling thread, so the app's pump dispatches it with everything else.
static shim_h shim_hidden_window(void) {
	shim_wchar cls[32];
	shim_wchar title[1];
	shim_wndclass wc;
	if (shim_utf16("CrustNotifyTray", cls, 32) < 0) return 0;
	title[0] = 0;
	shim_zero(&wc, sizeof(wc));
	wc.cbSize = (unsigned int)sizeof(wc);
	wc.lpfnWndProc = (void *)shim_tray_proc;
	wc.hInstance = GetModuleHandleW(0);
	wc.lpszClassName = cls;
	// A second registration answers 0 with ERROR_CLASS_ALREADY_EXISTS (1410), which is not a defect:
	// the class exists and the window can still be created, so the result is not checked.
	RegisterClassExW(&wc);
	return CreateWindowExW(0u, cls, title, 0u, 0, 0, 0, 0, 0, 0, wc.hInstance, 0);
}

// Put the icon in the notification area, once.
static int shim_icon_ensure(void) {
	if (g_added) return 1;
	if (!g_hwnd) {
		g_hwnd = shim_hidden_window();
		if (!g_hwnd) {
			shim_reason_set("the hidden message window could not be created (CreateWindowExW)");
			return 0;
		}
	}
	shim_nid nid;
	shim_zero(&nid, sizeof(nid));
	nid.cbSize = (unsigned int)sizeof(nid);
	nid.hWnd = g_hwnd;
	nid.uID = SHIM_TRAY_ID;
	nid.uFlags = SHIM_NIF_MESSAGE | SHIM_NIF_ICON | SHIM_NIF_TIP;
	nid.uCallbackMessage = SHIM_WM_TRAY;
	nid.hIcon = LoadIconW(0, SHIM_IDI_APPLICATION);
	shim_utf16("crust", nid.szTip, 128);
	if (!Shell_NotifyIconW(SHIM_NIM_ADD, &nid)) {
		shim_reason_set("Shell_NotifyIconW(NIM_ADD) returned FALSE — no notification area");
		return 0;
	}
	g_added = 1;
	return 1;
}

// A balloon, through the icon. `NIF_INFO` on `NIM_MODIFY` is the one notification mechanism that
// needs no COM toast registration and no AppUserModelID, which is why it is the mechanism here.
int shim_notify_post(const char *title, const char *body) {
	if (!shim_notify_load()) return 2;
	if (!shim_icon_ensure()) return 4;
	shim_nid nid;
	shim_zero(&nid, sizeof(nid));
	nid.cbSize = (unsigned int)sizeof(nid);
	nid.hWnd = g_hwnd;
	nid.uID = SHIM_TRAY_ID;
	nid.uFlags = SHIM_NIF_INFO;
	nid.dwInfoFlags = SHIM_NIIF_INFO;
	// The shell caps a balloon near ten seconds and ignores anything longer; 5000 is what the
	// platform default is on a fresh Windows 11 profile.
	nid.uTimeout = 5000u;
	if (shim_utf16(title, nid.szInfoTitle, 64) < 0) {
		shim_reason_set("the title did not convert to UTF-16 (MultiByteToWideChar)");
		return 3;
	}
	// 256 wide characters is the shell's own `szInfo`; a longer body is truncated there, not here.
	shim_utf16(body ? body : "", nid.szInfo, 256);
	if (!Shell_NotifyIconW(SHIM_NIM_MODIFY, &nid)) {
		shim_reason_set("Shell_NotifyIconW(NIM_MODIFY, NIF_INFO) returned FALSE");
		return 3;
	}
	shim_reason_set("Shell_NotifyIconW(NIM_MODIFY, NIF_INFO) returned TRUE");
	return 0;
}

// The recorded click, cleared as it is read. -1 when nothing was clicked since the last call; the
// adapter's poll turns it into `tray:click`, because a Win32 message is not a JavaScript callback.
int shim_tray_click(void) {
	int index = g_click;
	g_click = -1;
	return index;
}
