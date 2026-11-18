// --- `crust:notification` and `crust:tray` on Windows: the shared half -----
// Its own compilation unit, compiled by `notify-tray-ffi.ts`, for the reason darwin's notification
// unit is its own: it shares nothing with the window shim, so no other lane's `shim-source.ts`,
// `ffi.ts`, `backend.ts` or `PREFLIGHT` table changes when this file does.
//
// No headers: every user32/shell32 entry point is a hand-written prototype resolved at runtime,
// exactly like `12_win32.c`, because `cc()` links nothing and TinyCC's PE import thunk jumped to
// 0xFFFFFFFFFFFFFFFF on Windows x64. Nothing but ints and NUL-terminated strings crosses bun:ffi:
// `NOTIFYICONDATAW` and `WNDCLASSEXW` are built on this stack.
//
// The message pump is NOT here. The hidden window is created on the same thread Bun owns, and the
// app's existing `shim_pump` dispatches its messages, because `DispatchMessageW` is thread-wide, not
// per-module — a second `PeekMessageW` loop would fight the first one for every message.

typedef void *shim_h;
typedef unsigned short shim_wchar;
typedef unsigned long long shim_u64;
typedef long long shim_i64;

// The only two imports in the unit, and both are kernel32 — the two that do the resolving.
extern shim_h LoadLibraryA(const char *name);
extern void *GetProcAddress(shim_h module, const char *name);

static int (*MultiByteToWideChar)(unsigned int cp, unsigned int flags, const char *src, int srclen,
                                  shim_wchar *dst, int dstlen);
static unsigned int (*GetLastError)(void);
static shim_h (*GetModuleHandleW)(const shim_wchar *name);
static unsigned short (*RegisterClassExW)(void *wc);
static shim_h (*CreateWindowExW)(unsigned int ex, const shim_wchar *cls, const shim_wchar *title,
                                 unsigned int style, int x, int y, int w, int h, shim_h parent,
                                 shim_h menu, shim_h inst, void *param);
static shim_i64 (*DefWindowProcW)(shim_h hwnd, unsigned int msg, shim_u64 wp, shim_i64 lp);
static int (*DestroyWindow)(shim_h hwnd);
static shim_h (*LoadIconW)(shim_h instance, const shim_wchar *name);
static int (*Shell_NotifyIconW)(unsigned int action, void *data);
// `62_tray.c`: the popup menu, the mouse position and the two calls that make a menu dismiss.
static shim_h (*CreatePopupMenu)(void);
static int (*AppendMenuW)(shim_h menu, unsigned int flags, unsigned long long id,
                          const shim_wchar *text);
static int (*DestroyMenu)(shim_h menu);
static int (*TrackPopupMenu)(shim_h menu, unsigned int flags, int x, int y, int reserved,
                             shim_h hwnd, const void *rect);
static int (*GetCursorPos)(void *point);
static int (*SetForegroundWindow)(shim_h hwnd);
static int (*PostMessageW)(shim_h hwnd, unsigned int msg, shim_u64 wp, shim_i64 lp);

// `WNDCLASSEXW`, 80 bytes on x64. A struct, not a byte array: the offsets are the ABI, and
// `notify-tray-abi.test.ts` measures every one of them against a real compiler.
typedef struct {
	unsigned int cbSize;
	unsigned int style;
	void *lpfnWndProc;
	int cbClsExtra;
	int cbWndExtra;
	shim_h hInstance;
	shim_h hIcon;
	shim_h hCursor;
	shim_h hbrBackground;
	const shim_wchar *lpszMenuName;
	const shim_wchar *lpszClassName;
	shim_h hIconSm;
} shim_wndclass;

// `NOTIFYICONDATAW`, 976 bytes on x64. The `pad` fields are the alignment the ABI inserts; a struct
// that packs differently puts `szInfo` at the wrong offset and the balloon shows the tooltip text.
typedef struct {
	unsigned int cbSize;
	unsigned int pad0;
	shim_h hWnd;
	unsigned int uID;
	unsigned int uFlags;
	unsigned int uCallbackMessage;
	unsigned int pad1;
	shim_h hIcon;
	shim_wchar szTip[128];
	unsigned int dwState;
	unsigned int dwStateMask;
	shim_wchar szInfo[256];
	unsigned int uTimeout;
	shim_wchar szInfoTitle[64];
	unsigned int dwInfoFlags;
	unsigned char guidItem[16];
	shim_h hBalloonIcon;
} shim_nid;

#define SHIM_NIM_ADD 0u
#define SHIM_NIM_MODIFY 1u
#define SHIM_NIM_DELETE 2u
#define SHIM_NIF_MESSAGE 1u
#define SHIM_NIF_ICON 2u
#define SHIM_NIF_TIP 4u
#define SHIM_NIF_INFO 16u
#define SHIM_NIIF_INFO 1u
#define SHIM_WM_APP 0x8000u
// The callback message the notification area posts to the hidden window. WM_APP + 1 is the
// conventional slot; nothing else in this process uses WM_APP.
#define SHIM_WM_TRAY (SHIM_WM_APP + 1u)
#define SHIM_WM_COMMAND 0x0111u
#define SHIM_WM_RBUTTONUP 0x0205u
#define SHIM_WM_LBUTTONUP 0x0202u
#define SHIM_WM_LBUTTONDBLCLK 0x0203u
#define SHIM_TRAY_ID 1u
#define SHIM_IDI_APPLICATION ((const shim_wchar *)32512)

static char g_missing[64];
static char g_reason[256];
static int g_state; // 0 untried, 1 ready, -1 a module or an export was missing
static shim_h g_hwnd;
static int g_added;
static int g_click = -1;

static void shim_copy(char *dst, int cap, const char *src) {
	int i = 0;
	if (!dst || cap <= 0) return;
	if (!src) {
		dst[0] = 0;
		return;
	}
	while (src[i] && i < cap - 1) {
		dst[i] = src[i];
		i++;
	}
	dst[i] = 0;
}

static void shim_zero(void *p, unsigned long long bytes) {
	unsigned char *b = (unsigned char *)p;
	while (bytes--) *b++ = 0;
}

// One line, so the adapter can say why without a second call.
void shim_reason_set(const char *text) { shim_copy(g_reason, 256, text); }
const char *shim_notify_reason(void) { return g_reason; }
const char *shim_notify_missing(void) { return g_missing; }
int shim_notify_last_error(void) { return GetLastError ? (int)GetLastError() : 0; }

// UTF-8 in, UTF-16 out, in a caller-owned buffer. 65001 is CP_UTF8 and -1 is a NUL-terminated
// source. Returns the UTF-16 length written (truncated to `cap - 1`), or -1 when nothing converted.
static int shim_utf16(const char *src, shim_wchar *dst, int cap) {
	if (!src || !dst || cap <= 0 || !MultiByteToWideChar) return -1;
	int n = MultiByteToWideChar(65001u, 0u, src, -1, dst, cap);
	if (n <= 0) return -1;
	dst[n - 1] = 0;
	return n - 1;
}

// `__typeof__` keeps each pointer's exact prototype, so no cast is written twice. It is the one GNU
// extension in this unit, the same one `12_win32.c` uses.
#define SHIM_BIND(module, name)                            \
	do {                                                   \
		void *shim_symbol = GetProcAddress(module, #name);  \
		if (!shim_symbol) {                                 \
			shim_copy(g_missing, 64, #name);                \
			return 0;                                       \
		}                                                  \
		name = (__typeof__(name))shim_symbol;               \
	} while (0)

// The later parts: the window procedure and the icon `61_notify.c` builds, the menu `62_tray.c` opens.
shim_i64 shim_tray_proc(shim_h hwnd, unsigned int msg, shim_u64 wp, shim_i64 lp);
int shim_tray_menu_open(shim_h hwnd);

// 1 when every entry point resolved, 0 when one did not — named by `shim_notify_missing`. Asked
// before any other call, because a null pointer here is a call to address zero, not a bad return.
int shim_notify_load(void) {
	if (g_state) return g_state > 0;
	g_state = -1;
	shim_h user32 = LoadLibraryA("user32.dll");
	if (!user32) {
		shim_copy(g_missing, 64, "user32.dll");
		return 0;
	}
	SHIM_BIND(user32, MultiByteToWideChar);
	SHIM_BIND(user32, GetLastError);
	SHIM_BIND(user32, GetModuleHandleW);
	SHIM_BIND(user32, RegisterClassExW);
	SHIM_BIND(user32, CreateWindowExW);
	SHIM_BIND(user32, DefWindowProcW);
	SHIM_BIND(user32, DestroyWindow);
	SHIM_BIND(user32, LoadIconW);
	SHIM_BIND(user32, CreatePopupMenu);
	SHIM_BIND(user32, AppendMenuW);
	SHIM_BIND(user32, DestroyMenu);
	SHIM_BIND(user32, TrackPopupMenu);
	SHIM_BIND(user32, GetCursorPos);
	SHIM_BIND(user32, SetForegroundWindow);
	SHIM_BIND(user32, PostMessageW);
	shim_h shell32 = LoadLibraryA("shell32.dll");
	if (!shell32) {
		shim_copy(g_missing, 64, "shell32.dll");
		return 0;
	}
	SHIM_BIND(shell32, Shell_NotifyIconW);
	g_state = 1;
	return 1;
}

int shim_notify_ready(void) { return shim_notify_load(); }
