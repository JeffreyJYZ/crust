// crust windows shim — compiled at launch by bun:ffi's cc().
// No headers: TinyCC has no Windows SDK here, so every user32/kernel32/ole32 entry point is a
// hand-written prototype, the same rule the darwin shim follows. Nothing but ints, doubles and
// opaque pointers crosses bun:ffi; every string is converted to UTF-16 here and consumed here.
// x64/arm64 only: one calling convention, which is why no __stdcall appears.
//
// NOTHING IS LINKED. Every Win32 and WebView2 entry point is a pointer resolved at runtime by
// `12_win32.c`: TinyCC's PE import thunk for a DLL jumped to 0xFFFFFFFFFFFFFFFF on the first call
// on Windows x64 (2026-11-16), and a pointer this unit resolved itself has no thunk to get wrong.

typedef void *shim_h;
typedef unsigned short shim_wchar;
typedef unsigned long long shim_u64;
typedef long long shim_i64;

// The only two imports in the unit, and they are the two that do the resolving. Both are kernel32,
// which TinyCC's PE runtime links for its own CRT whether or not `cc()` asks for a library, so they
// need no `library` entry — and they cannot be resolved the way everything else is.
extern shim_h LoadLibraryA(const char *name);
extern void *GetProcAddress(shim_h module, const char *name);

// --- the Win32 entry points, as pointers -----------------------------------
// A function pointer is called with the same syntax as a function, so every call site below reads
// exactly as it did when these were `extern` declarations. `12_win32.c` binds all of them.
static int (*MultiByteToWideChar)(unsigned int cp, unsigned int flags, const char *src, int srclen,
                                  shim_wchar *dst, int dstlen);
static unsigned int (*GetLastError)(void);
static unsigned int (*GetCurrentThreadId)(void);
static unsigned int (*GetWindowThreadProcessId)(shim_h hwnd, unsigned int *processId);
static unsigned long long (*GetTickCount64)(void);
static unsigned long long (*VirtualQuery)(const void *address, void *buffer,
                                          unsigned long long length);
// `int`, not `shim_i64`: CoGetApartmentType returns a 32-bit HRESULT, and a wider declaration reads an
// undefined top half of RAX — the same trap as the vtable calls.
static int (*CoGetApartmentType)(int *aptType, int *aptQualifier);
static void (*Sleep)(unsigned int ms);
static shim_h (*LoadLibraryW)(const shim_wchar *name);
static shim_h (*GetModuleHandleW)(const shim_wchar *name);

static shim_h (*LoadCursorW)(shim_h instance, const shim_wchar *name);
static unsigned short (*RegisterClassExW)(void *wc);
static shim_h (*CreateWindowExW)(unsigned int ex, const shim_wchar *cls, const shim_wchar *title,
                                 unsigned int style, int x, int y, int w, int h, shim_h parent,
                                 shim_h menu, shim_h inst, void *param);
static int (*DestroyWindow)(shim_h hwnd);
static int (*IsWindow)(shim_h hwnd);
static int (*ShowWindow)(shim_h hwnd, int cmd);
static int (*UpdateWindow)(shim_h hwnd);
static int (*GetClientRect)(shim_h hwnd, void *rect);
static int (*SetWindowTextW)(shim_h hwnd, const shim_wchar *text);
static int (*PeekMessageW)(void *msg, shim_h hwnd, unsigned int min, unsigned int max, int remove);
static int (*TranslateMessage)(const void *msg);
static shim_i64 (*DispatchMessageW)(const void *msg);
static shim_i64 (*DefWindowProcW)(shim_h hwnd, unsigned int msg, shim_u64 wp, shim_i64 lp);
static void (*PostQuitMessage)(int code);
static shim_i64 (*CoInitializeEx)(void *reserved, unsigned int coinit);

// Defined in `12_win32.c`: one LoadLibraryA per module, one GetProcAddress per pointer above.
int shim_win32_load(void);
int shim_win32_ready(void);

#define SHIM_WS_OVERLAPPEDWINDOW 0x00CF0000u
#define SHIM_CW_USEDEFAULT ((int)0x80000000)
#define SHIM_SW_SHOW 5
#define SHIM_WM_DESTROY 2
#define SHIM_WM_SIZE 5
#define SHIM_WM_CLOSE 16
#define SHIM_PM_REMOVE 1
#define SHIM_COINIT_APARTMENTTHREADED 2
#define SHIM_IDC_ARROW ((const shim_wchar *)32512)

// --- COM vtable slots ------------------------------------------------------
// Zero-based, counted after IUnknown's QueryInterface/AddRef/Release. Checked against the
// declaration order in WebView2.h as published (docs.rs/webview2-sys ICoreWebView2VTable and
// ICoreWebView2ControllerVTable, read 2026-11-16) — `Navigate` is the fifth method of
// ICoreWebView2, and this layer called slot 37 for a year of one run, which is
// GetBrowserProcessId(UINT*) and silently did nothing.
#define SHIM_SLOT_ENV_CREATE_CONTROLLER 3  // ICoreWebView2Environment::CreateCoreWebView2Controller
#define SHIM_SLOT_IUNKNOWN_ADDREF 1        // IUnknown::AddRef — the refcount a borrowed object needs
#define SHIM_SLOT_CONTROLLER_PUT_BOUNDS 6  // ICoreWebView2Controller::put_Bounds
#define SHIM_SLOT_CONTROLLER_CLOSE 24      // ICoreWebView2Controller::Close
#define SHIM_SLOT_CONTROLLER_WEBVIEW 25    // ICoreWebView2Controller::get_CoreWebView2
#define SHIM_SLOT_WEBVIEW_NAVIGATE 5       // ICoreWebView2::Navigate

// Defined in `42_webview.c`; the window procedure's size handler resizes the controller with it.
int shim_webview_put_bounds(shim_h hwnd, double w, double h);

// --- thread bookkeeping -----------------------------------------------------
// `CreateCoreWebView2Controller` answered UI_E_WRONG_THREAD (0x802A000C, "this method can only be
// called from the thread that created the object") while the environment call on the same code path
// succeeded. Which thread each step ran on is therefore the measurement, not a guess: every step
// records it and the probe prints them side by side.
#define SHIM_THREAD_COM 0
#define SHIM_THREAD_ENV_CALL 1
#define SHIM_THREAD_ENV_CALLBACK 2
#define SHIM_THREAD_CTRL_CALL 3
#define SHIM_THREAD_CTRL_CALLBACK 4
#define SHIM_THREAD_STEPS 5
static unsigned int g_threads[SHIM_THREAD_STEPS];

static void shim_note_thread(int step) {
	if (step >= 0 && step < SHIM_THREAD_STEPS)
		g_threads[step] = GetCurrentThreadId ? GetCurrentThreadId() : 0;
}

unsigned int shim_thread_at(int step) {
	if (step < 0 || step >= SHIM_THREAD_STEPS) return 0;
	return g_threads[step];
}

unsigned int shim_thread_id(void) { return GetCurrentThreadId ? GetCurrentThreadId() : 0; }

// Defined in `32_env.c`: the controller is created inside the environment's completion callback,
// because a WebView2 object may only be called from the frame that created it.
void shim_controller_from_callback(void *env);

// --- strings ---------------------------------------------------------------

// UTF-8 in, UTF-16 out, in a caller-owned buffer. 65001 is CP_UTF8 and -1 means
// "NUL-terminated source". Returns the UTF-16 length, or -1 when nothing converted.
// Every string in the layer comes through here, so the resolve check is one line rather than one
// per entry point: an unbound pointer is a null call, not a bad return.
int shim_utf16(const char *src, shim_wchar *dst, int cap) {
	if (!src || !dst || cap <= 0) return -1;
	if (!shim_win32_load()) return -1;
	int n = MultiByteToWideChar(65001u, 0u, src, -1, dst, cap);
	if (n <= 0) return -1;
	dst[n - 1] = 0;
	return n - 1;
}

// Answered during a failure path too, so a pointer that never bound reads 0 instead of faulting.
shim_i64 shim_last_error(void) { return GetLastError ? (shim_i64)GetLastError() : 0; }

// STA, because WebView2's controller must live on the thread that created the window and a
// free-threaded apartment would marshal every call. S_FALSE (1) means already initialised.
// E_FAIL when the entry points did not resolve, which `shim_win32_ready` reports first.
shim_i64 shim_com_init(void) {
	if (!shim_win32_load()) return -2147467259LL;
	shim_note_thread(SHIM_THREAD_COM);
	return (shim_i64)CoInitializeEx(0, SHIM_COINIT_APARTMENTTHREADED);
}

// --- pump ------------------------------------------------------------------

// MSG is 48 bytes on x64. It is never read on this side: PeekMessageW fills it,
// TranslateMessage and DispatchMessageW consume it.
typedef struct {
	shim_i64 a, b, c, d, e, f;
} shim_msg;

// One slice: drain what is queued, then return, so Bun's timer keeps the cadence the darwin
// pump has. PM_REMOVE is 1 — without it the same message dispatches forever.
int shim_pump(void) {
	shim_msg msg;
	int handled = 0;
	if (!shim_win32_load()) return 0;
	while (PeekMessageW(&msg, 0, 0, 0, SHIM_PM_REMOVE)) {
		TranslateMessage(&msg);
		DispatchMessageW(&msg);
		handled++;
	}
	return handled;
}

void shim_post_quit(void) {
	if (PostQuitMessage) PostQuitMessage(0);
}
