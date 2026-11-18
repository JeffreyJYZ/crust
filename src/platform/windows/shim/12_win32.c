// --- every Win32 entry point, resolved at runtime --------------------------
// `cc()` links nothing at all. On Windows x64 the import thunk TinyCC built for a DLL jumped to
// 0xFFFFFFFFFFFFFFFF on the first call (2026-11-16, `09dbdf1`), and a pointer resolved here has no
// thunk to get wrong. One LoadLibraryA per module, one GetProcAddress per function, all cached in
// the statics `10_prelude.c` declares: kernel32 is already in the process, so its handle is a
// refcount, and user32/ole32 load on demand.
//
// `shim_win32_ready` is what the platform asks before it calls anything, so a machine missing an
// export is a message rather than a null call.
static shim_h g_kernel32;
static shim_h g_user32;
static shim_h g_ole32;
// The two modules only the clipboard/opener/`os.info` table needs: shell32 for the association
// lookup, ntdll for the version call that does not lie without a manifest.
static shim_h g_shell32;
static shim_h g_ntdll;

// `__typeof__` keeps each pointer's exact prototype, so no cast is written twice and no call site
// is retyped here. It is the one GNU extension in this unit; TinyCC and clang both accept it.
#define SHIM_BIND(module, name)                           \
	do {                                                  \
		void *shim_symbol = GetProcAddress(module, #name); \
		if (!shim_symbol) return 0;                       \
		name = (__typeof__(name))shim_symbol;             \
	} while (0)

// 0 = not tried, 1 = ready, -1 = a module or an entry point was missing.
static int g_win32_state;

int shim_win32_load(void) {
	if (g_win32_state) return g_win32_state > 0;
	g_win32_state = -1;

	g_kernel32 = LoadLibraryA("kernel32.dll");
	if (!g_kernel32) return 0;
	SHIM_BIND(g_kernel32, MultiByteToWideChar);
	SHIM_BIND(g_kernel32, GetLastError);
	SHIM_BIND(g_kernel32, GetCurrentThreadId);
	SHIM_BIND(g_kernel32, GetTickCount64);
	SHIM_BIND(g_kernel32, VirtualQuery);
	SHIM_BIND(g_kernel32, Sleep);
	SHIM_BIND(g_kernel32, LoadLibraryW);
	SHIM_BIND(g_kernel32, GetModuleHandleW);

	g_user32 = LoadLibraryA("user32.dll");
	if (!g_user32) return 0;
	SHIM_BIND(g_user32, LoadCursorW);
	SHIM_BIND(g_user32, RegisterClassExW);
	SHIM_BIND(g_user32, CreateWindowExW);
	SHIM_BIND(g_user32, DestroyWindow);
	SHIM_BIND(g_user32, IsWindow);
	SHIM_BIND(g_user32, ShowWindow);
	SHIM_BIND(g_user32, UpdateWindow);
	SHIM_BIND(g_user32, GetClientRect);
	SHIM_BIND(g_user32, GetWindowRect);
	SHIM_BIND(g_user32, SetWindowPos);
	SHIM_BIND(g_user32, IsIconic);
	SHIM_BIND(g_user32, IsZoomed);
	SHIM_BIND(g_user32, SetForegroundWindow);
	SHIM_BIND(g_user32, SetWindowTextW);
	SHIM_BIND(g_user32, PeekMessageW);
	SHIM_BIND(g_user32, TranslateMessage);
	SHIM_BIND(g_user32, DispatchMessageW);
	SHIM_BIND(g_user32, DefWindowProcW);
	SHIM_BIND(g_user32, PostQuitMessage);
	SHIM_BIND(g_user32, GetWindowThreadProcessId);
	SHIM_BIND(g_user32, EnumDisplayMonitors);
	SHIM_BIND(g_user32, GetMonitorInfoW);
	// `11_win32_style.c`: the style, opacity, placement and pointer calls the window plugin's chrome
	// and fullscreen members make. All user32, all resolved here like every other pointer.
	SHIM_BIND(g_user32, GetWindowLongPtrW);
	SHIM_BIND(g_user32, SetWindowLongPtrW);
	SHIM_BIND(g_user32, SetLayeredWindowAttributes);
	SHIM_BIND(g_user32, GetLayeredWindowAttributes);
	SHIM_BIND(g_user32, GetWindowPlacement);
	SHIM_BIND(g_user32, SetCursor);
	SHIM_BIND(g_user32, ShowCursor);
	SHIM_BIND(g_user32, MonitorFromWindow);
	// The clipboard half of `11_pointer_core.c`. user32 owns the clipboard itself.
	SHIM_BIND(g_user32, OpenClipboard);
	SHIM_BIND(g_user32, CloseClipboard);
	SHIM_BIND(g_user32, EmptyClipboard);
	SHIM_BIND(g_user32, GetClipboardData);
	SHIM_BIND(g_user32, SetClipboardData);

	// kernel32 also owns the global heap, the UTF-8 direction and the user's locale.
	SHIM_BIND(g_kernel32, GlobalAlloc);
	SHIM_BIND(g_kernel32, GlobalLock);
	SHIM_BIND(g_kernel32, GlobalUnlock);
	SHIM_BIND(g_kernel32, GlobalFree);
	SHIM_BIND(g_kernel32, WideCharToMultiByte);
	SHIM_BIND(g_kernel32, GetUserDefaultLocaleName);

	// shell32 answers the double-click association lookup, ntdll the real build number.
	g_shell32 = LoadLibraryA("shell32.dll");
	if (!g_shell32) return 0;
	SHIM_BIND(g_shell32, ShellExecuteW);

	g_ntdll = LoadLibraryA("ntdll.dll");
	if (!g_ntdll) return 0;
	SHIM_BIND(g_ntdll, RtlGetVersion);

	g_ole32 = LoadLibraryA("ole32.dll");
	if (!g_ole32) return 0;
	SHIM_BIND(g_ole32, CoInitializeEx);
	SHIM_BIND(g_ole32, CoGetApartmentType);

	g_win32_state = 1;
	return 1;
}

// 1 when every pointer above is callable; 0 when a module or an export was missing.
int shim_win32_ready(void) { return shim_win32_load(); }
