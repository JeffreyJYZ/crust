// --- the style, placement and pointer entry points -------------------------
// Declared apart from `10_prelude.c` so that file stays one screen: this is the block the window
// style, opacity, pointer and fullscreen members need, and `12_win32.c` binds all of it.
//
// **`GetWindowLongPtrW`, never `GetWindowLongW`.** `LONG` is 32-bit on Windows even at x64, so the
// 32-bit call truncates a `LONG_PTR`; `LONG_PTR` is pointer-sized, which is why the `…Ptr` call is
// the one to declare at both 64-bit ABIs and why `GetWindowLongW` is not bound at all.
//
// The style itself is still a 32-bit value: `GWL_STYLE` and `GWL_EXSTYLE` each hold a `DWORD`, so
// every style number that crosses `bun:ffi` is an `int`, while only the `…Ptr` return is 64-bit.

// LONG_PTR by another name: `shim_i64` is the same width and keeps one vocabulary in the ABI audit.
static shim_i64 (*GetWindowLongPtrW)(shim_h hwnd, int index);
static shim_i64 (*SetWindowLongPtrW)(shim_h hwnd, int index, shim_i64 value);
static int (*SetLayeredWindowAttributes)(shim_h hwnd, unsigned int key, unsigned char alpha,
                                        unsigned int flags);
static int (*GetLayeredWindowAttributes)(shim_h hwnd, unsigned int *key, unsigned char *alpha,
                                        unsigned int *flags);
static int (*GetWindowPlacement)(shim_h hwnd, void *placement);
static shim_h (*SetCursor)(shim_h cursor);
static int (*ShowCursor)(int show);
static shim_h (*MonitorFromWindow)(shim_h hwnd, unsigned int flags);

// WINDOWPLACEMENT, 44 bytes on x64 and arm64: three DWORDs, two POINTs, then the restore RECT.
// `length` must be set by the caller or `GetWindowPlacement` refuses with ERROR_INVALID_PARAMETER.
typedef struct {
	unsigned int length;
	unsigned int flags;
	unsigned int showCmd;
	int ptMinX;
	int ptMinY;
	int ptMaxX;
	int ptMaxY;
	int normalLeft;
	int normalTop;
	int normalRight;
	int normalBottom;
} shim_window_placement;

// --- the bits these calls read and write -----------------------------------
#define SHIM_GWL_STYLE (-16)
#define SHIM_GWL_EXSTYLE (-20)
// WS_OVERLAPPEDWINDOW: WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX.
// All five go and come back together; clearing only WS_CAPTION leaves an invisible resize border
// that still swallows clicks.
#define SHIM_WS_FRAME 0x00CF0000u
#define SHIM_WS_CAPTION 0x00C00000u
// WS_POPUP: the style a borderless fullscreen window carries, and the bit `isFullscreen` reads.
#define SHIM_WS_POPUP 0x80000000u
#define SHIM_WS_EX_TOPMOST 0x00000008u
#define SHIM_WS_EX_LAYERED 0x00080000u
#define SHIM_LWA_ALPHA 0x00000002u
// SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE: a z-order change that moves and focuses nothing.
#define SHIM_SWP_TOPMOST 0x0013u
// The same plus SWP_FRAMECHANGED (0x0020): a style write that also repaints the non-client area.
#define SHIM_SWP_FRAME_ONLY 0x0034u
#define SHIM_HWND_TOPMOST ((shim_h)-1)
#define SHIM_HWND_NOTOPMOST ((shim_h)-2)
#define SHIM_MONITOR_DEFAULTTONEAREST 2u
// The four cursors this layer maps a name to. `grab` is IDC_SIZEALL: Windows has no open-hand
// cursor in its standard set, and the four-way arrow is what a drag affordance uses there.
#define SHIM_IDC_HAND ((const shim_wchar *)32649)
#define SHIM_IDC_CROSS ((const shim_wchar *)32515)
#define SHIM_IDC_IBEAM ((const shim_wchar *)32513)
#define SHIM_IDC_SIZEALL ((const shim_wchar *)32646)
#define SHIM_WM_SETCURSOR 0x0020u

// Defined in `49_cursor.c` and called from `20_class.c`'s window procedure: the pointer is the
// thread's, so it is re-applied on every WM_SETCURSOR or the next mouse move resets it.
int shim_cursor_apply(void);

// Defined in `45_style.c`. `set_decorated` reads its own read-back to answer, so the two are declared
// here rather than relying on definition order within that unit.
int shim_window_is_decorated(shim_h hwnd);
int shim_window_style(shim_h hwnd, int *out);
