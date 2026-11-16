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
	SHIM_BIND(g_user32, SetWindowTextW);
	SHIM_BIND(g_user32, PeekMessageW);
	SHIM_BIND(g_user32, TranslateMessage);
	SHIM_BIND(g_user32, DispatchMessageW);
	SHIM_BIND(g_user32, DefWindowProcW);
	SHIM_BIND(g_user32, PostQuitMessage);

	g_ole32 = LoadLibraryA("ole32.dll");
	if (!g_ole32) return 0;
	SHIM_BIND(g_ole32, CoInitializeEx);

	g_win32_state = 1;
	return 1;
}

// 1 when every pointer above is callable; 0 when a module or an export was missing.
int shim_win32_ready(void) { return shim_win32_load(); }
