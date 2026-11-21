// --- the surface table ------------------------------------------------------
// One entry per webview surface: its window, its controller, its ICoreWebView2, the HRESULT each step
// answered and the rectangle this layer last applied. **Entry 0 is the app's own window** —
// `shim_surface_reserve` hands out the first free slot, so a single-window app always talks to
// handle 0 and every call that predates the table keeps its meaning.
//
// A handle is an index and it never moves. `shim_surface_release` clears `used` and the next reserve
// reuses that slot; compacting the array on close — which the one-slot version did — would have made
// every live handle name a different surface, and a handle is what a caller holds across calls. Reuse
// is also what stops eight failed creates from ending window creation for the process.
//
// **Nothing here calls Win32 or COM, and nothing here uses a prelude typedef.** The file is compiled
// on its own by `surfaces.test.ts` and driven through bun:ffi, so "two handles keep separate state" is
// a measurement on a machine with no user32 rather than a sentence. The window shim compiles the same
// file as one of its parts, which is why every entry point answers a refusal for an out-of-range
// handle instead of trusting its caller.
//
// `g_surface_url` is a wide buffer per surface, not one shared static: WebView2 marshals a string to
// its browser process lazily, so the buffer a `Navigate` handed over has to stay valid and must not be
// overwritten by the other surface's navigation.

#define SHIM_MAX_SURFACES 8
#define SHIM_SURFACE_URL_MAX 2048

// The four steps that can refuse, indexed through `shim_surface_hr`/`shim_surface_set_hr`. 0, 1 and 2
// are the published order `shim_attach_hresult` reports; Navigate is the fourth.
#define SHIM_SURFACE_WEBVIEW 0
#define SHIM_SURFACE_BOUNDS 1
#define SHIM_SURFACE_VISIBLE 2
#define SHIM_SURFACE_NAVIGATE 3
#define SHIM_SURFACE_STEPS 4

typedef struct {
	int used;
	void *hwnd; /* the window the controller was built for; 0 for a child surface */
	void *ctrl; /* ICoreWebView2Controller */
	void *web;  /* ICoreWebView2 */
	int hr[SHIM_SURFACE_STEPS];
	double bounds[4]; /* x, y, width, height — the rectangle last applied */
} shim_surface;

static shim_surface g_surface[SHIM_MAX_SURFACES];
static unsigned short g_surface_url[SHIM_MAX_SURFACES][SHIM_SURFACE_URL_MAX];

static int shim_surface_has(int handle) {
	return handle >= 0 && handle < SHIM_MAX_SURFACES && g_surface[handle].used;
}

/** How many surfaces are live. WM_DESTROY reads this after a close to decide the quit. */
int shim_surface_live(void) {
	int i;
	int live = 0;
	for (i = 0; i < SHIM_MAX_SURFACES; i++)
		if (g_surface[i].used) live++;
	return live;
}

/** The first free slot, cleared and marked live; -1 when the table is full. */
int shim_surface_reserve(void *hwnd) {
	int i;
	int step;
	for (i = 0; i < SHIM_MAX_SURFACES; i++) {
		if (g_surface[i].used) continue;
		g_surface[i].used = 1;
		g_surface[i].hwnd = hwnd;
		g_surface[i].ctrl = 0;
		g_surface[i].web = 0;
		for (step = 0; step < SHIM_SURFACE_STEPS; step++) g_surface[i].hr[step] = 0;
		for (step = 0; step < 4; step++) g_surface[i].bounds[step] = 0;
		return i;
	}
	return -1;
}

/** The handle a window's surface sits at; -1 when no live surface names it. */
int shim_surface_index(void *hwnd) {
	int i;
	if (!hwnd) return -1;
	for (i = 0; i < SHIM_MAX_SURFACES; i++)
		if (g_surface[i].used && g_surface[i].hwnd == hwnd) return i;
	return -1;
}

void *shim_surface_hwnd(int handle) {
	return shim_surface_has(handle) ? g_surface[handle].hwnd : 0;
}

void *shim_surface_ctrl(int handle) {
	return shim_surface_has(handle) ? g_surface[handle].ctrl : 0;
}

void *shim_surface_web(int handle) {
	return shim_surface_has(handle) ? g_surface[handle].web : 0;
}

int shim_surface_set_ctrl(int handle, void *ctrl) {
	if (!shim_surface_has(handle)) return 0;
	g_surface[handle].ctrl = ctrl;
	return 1;
}

int shim_surface_set_web(int handle, void *web) {
	if (!shim_surface_has(handle)) return 0;
	g_surface[handle].web = web;
	return 1;
}

/** Record one step's HRESULT. A refusal for a bad handle, because a probe must not write elsewhere. */
int shim_surface_set_hr(int handle, int which, int hr) {
	if (!shim_surface_has(handle) || which < 0 || which >= SHIM_SURFACE_STEPS) return 0;
	g_surface[handle].hr[which] = hr;
	return 1;
}

int shim_surface_hr(int handle, int which) {
	if (!shim_surface_has(handle) || which < 0 || which >= SHIM_SURFACE_STEPS) return 0;
	return g_surface[handle].hr[which];
}

/** This surface's Navigate buffer, or 0 for a bad handle. */
unsigned short *shim_surface_url(int handle) {
	return shim_surface_has(handle) ? g_surface_url[handle] : 0;
}

/** Record the rectangle put_Bounds was given, after the call succeeded. */
int shim_surface_set_bounds(int handle, double x, double y, double w, double h) {
	if (!shim_surface_has(handle)) return 0;
	g_surface[handle].bounds[0] = x;
	g_surface[handle].bounds[1] = y;
	g_surface[handle].bounds[2] = w;
	g_surface[handle].bounds[3] = h;
	return 1;
}

/** 0 x, 1 y, 2 width, 3 height; 0 for a bad handle or index. */
double shim_surface_bound(int handle, int which) {
	if (!shim_surface_has(handle) || which < 0 || which > 3) return 0;
	return g_surface[handle].bounds[which];
}

/** Free the slot. Idempotent, so a title-bar close and a failed create can both call it. */
void shim_surface_release(int handle) {
	if (!shim_surface_has(handle)) return;
	g_surface[handle].used = 0;
	g_surface[handle].hwnd = 0;
	g_surface[handle].ctrl = 0;
	g_surface[handle].web = 0;
}
