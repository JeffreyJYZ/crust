// --- monitors --------------------------------------------------------------
// EnumDisplayMonitors + GetMonitorInfoW, into the same ten doubles the darwin unit writes: frame
// x/y/w/h, work area x/y/w/h, scale, then the primary flag.
//
// Win32 already reports a top-left origin with y down, so nothing is flipped here — the flip lives
// in the darwin half, where AppKit's origin is bottom-left. `scale` is 1.0: per-monitor DPI needs
// `GetDpiForMonitor` from shcore.dll, which this unit does not load, and answering the real number
// would mean a second module in the preflight table for a value one window cannot change.

#define SHIM_MONITOR_COUNT_MAX 8

// MONITORINFOEXW: DWORD cbSize, RECT rcMonitor, RECT rcWork, DWORD dwFlags, WCHAR szDevice[32].
// RECT is four 32-bit LONGs even on x64, so the struct is 104 bytes with 4-byte alignment.
// `shim_rect` itself comes from `34_slots.c`, which defines it for the controller bounds — the shim
// is one translation unit, so redefining it here is a compile error, not a second independent type.

typedef struct {
	unsigned int cbSize;
	shim_rect rcMonitor;
	shim_rect rcWork;
	unsigned int dwFlags;
	unsigned short szDevice[32];
} shim_monitor_info;

typedef struct {
	double x;
	double y;
	double width;
	double height;
	double workX;
	double workY;
	double workWidth;
	double workHeight;
	double scale;
	double primary;
} shim_screen_entry;

static shim_screen_entry g_screens[SHIM_MONITOR_COUNT_MAX];
static int g_screen_count;
/** The index the next callback writes: `lParam` is one fixed value, so the counter lives here. */
static int g_screen_next;

// The callback EnumDisplayMonitors calls once per display. BOOL CALLBACK is four arguments on x64 —
// one calling convention, so no __stdcall. The primary is rcMonitor's origin at 0,0, which is what
// Win32 makes the primary display's rectangle by definition.
static int shim_screen_enum(shim_h monitor, shim_h dc, void *rect, shim_i64 data) {
	shim_monitor_info info;
	int index = g_screen_next;
	(void)dc;
	(void)rect;
	(void)data;
	if (index < 0 || index >= SHIM_MONITOR_COUNT_MAX) return 0;
	// `info.cbSize` is the only field GetMonitorInfoW reads before it writes, and it must be set.
	info.cbSize = (unsigned int)sizeof(shim_monitor_info);
	if (!GetMonitorInfoW(monitor, &info)) return 1;
	shim_screen_entry *entry = &g_screens[index];
	entry->x = (double)info.rcMonitor.left;
	entry->y = (double)info.rcMonitor.top;
	entry->width = (double)(info.rcMonitor.right - info.rcMonitor.left);
	entry->height = (double)(info.rcMonitor.bottom - info.rcMonitor.top);
	entry->workX = (double)info.rcWork.left;
	entry->workY = (double)info.rcWork.top;
	entry->workWidth = (double)(info.rcWork.right - info.rcWork.left);
	entry->workHeight = (double)(info.rcWork.bottom - info.rcWork.top);
	entry->scale = 1.0;
	entry->primary = (info.rcMonitor.left == 0 && info.rcMonitor.top == 0) ? 1.0 : 0.0;
	g_screen_next = index + 1;
	g_screen_count = g_screen_next;
	return 1;
}

// How many displays the machine has; 0 before the Win32 entry points resolved, which is the honest
// answer for a machine that cannot enumerate at all.
int shim_screen_count(void) {
	if (!shim_win32_load()) return 0;
	g_screen_count = 0;
	g_screen_next = 0;
	EnumDisplayMonitors(0, 0, (void *)shim_screen_enum, (shim_i64)0);
	return g_screen_count;
}

// The monitor a window is on, one component of its full rect: 0 x, 1 y, 2 width, 3 height.
// MONITOR_DEFAULTTONEAREST, so a window straddling two displays answers the nearer one rather than
// nothing — which is what a fullscreen toggle needs, since "the monitor it is mostly on" is the one
// it should cover.
int shim_window_monitor_num(shim_h hwnd, int component) {
	shim_monitor_info info;
	shim_h monitor;
	if (!hwnd || !shim_win32_load()) return 0;
	monitor = MonitorFromWindow(hwnd, SHIM_MONITOR_DEFAULTTONEAREST);
	if (!monitor) return 0;
	info.cbSize = (unsigned int)sizeof(shim_monitor_info);
	if (!GetMonitorInfoW(monitor, &info)) return 0;
	if (component == 0) return info.rcMonitor.left;
	if (component == 1) return info.rcMonitor.top;
	if (component == 2) return info.rcMonitor.right - info.rcMonitor.left;
	if (component == 3) return info.rcMonitor.bottom - info.rcMonitor.top;
	return 0;
}

// Ten doubles for one display; 1 written, 0 when `index` names nothing this enumeration saw.
int shim_screen_info(int index, double *out) {
	if (out == 0 || index < 0) return 0;
	if (index >= g_screen_count) {
		// A caller that did not ask `shim_screen_count` first still gets an answer: re-enumerate
		// once, so the two calls agree even when the display set changed between them.
		if (shim_screen_count() <= index) return 0;
	}
	const shim_screen_entry *entry = &g_screens[index];
	out[0] = entry->x;
	out[1] = entry->y;
	out[2] = entry->width;
	out[3] = entry->height;
	out[4] = entry->workX;
	out[5] = entry->workY;
	out[6] = entry->workWidth;
	out[7] = entry->workHeight;
	out[8] = entry->scale;
	out[9] = entry->primary;
	return 1;
}
