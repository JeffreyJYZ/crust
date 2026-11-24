// Scratch-only perf scaffold. Compiled by bun:ffi cc() in perf-native.ts.
// Every objc_msgSend has a FIXED prototype; no struct crosses the boundary.
typedef void *obj_t;
extern obj_t objc_msgSend(void *self, void *sel, ...);
extern obj_t objc_getClass(const char *name);
extern obj_t sel_registerName(const char *name);
extern obj_t __CFStringMakeConstantString(const char *cstr);

static obj_t perf_number_bool(int v) {
	obj_t a = ((obj_t (*)(void *, void *))objc_msgSend)(
	    objc_getClass("NSNumber"), sel_registerName("alloc"));
	if (!a) return 0;
	return ((obj_t (*)(void *, void *, char))objc_msgSend)(
	    a, sel_registerName("initWithBool:"), v ? 1 : 0);
}

static obj_t perf_view(obj_t win) {
	return ((obj_t (*)(void *, void *))objc_msgSend)(win, sel_registerName("contentView"));
}

/** The only safe existence test before a private send. */
int perf_has_sel(obj_t obj, const char *name) {
	if (!obj || !name) return 0;
	void *sel = sel_registerName(name);
	if (!sel) return 0;
	return (int)((char (*)(void *, void *, void *))objc_msgSend)(
	    obj, sel_registerName("respondsToSelector:"), sel);
}

/**
 * PRIVATE WebKit selector _setWindowOcclusionDetectionEnabled: — unsupported SPI,
 * harness scaffolding only, NEVER a shipped default. Stops WebKit suspending rAF
 * for a non-frontmost probe window. Returns 1 only when the selector existed.
 */
int perf_occlusion(obj_t web, int enabled) {
	if (!web) return 0;
	const char *name = "_setWindowOcclusionDetectionEnabled:";
	if (!perf_has_sel(web, name)) return 0;
	((void (*)(void *, void *, char))objc_msgSend)(
	    web, sel_registerName(name), enabled ? 1 : 0);
	return 1;
}

/** Public NSWindow occlusionState: bit 2 means the WindowServer composites it. */
long long perf_occlusion_state(obj_t win) {
	if (!win || !perf_has_sel(win, "occlusionState")) return -1;
	return ((long long (*)(void *, void *))objc_msgSend)(
	    win, sel_registerName("occlusionState"));
}

/** Public NSProcessInfo activity, held for the process lifetime to defeat App Nap. */
static obj_t perf_activity;
int perf_keep_awake(void) {
	if (perf_activity) return 1;
	obj_t info = ((obj_t (*)(void *, void *))objc_msgSend)(
	    objc_getClass("NSProcessInfo"), sel_registerName("processInfo"));
	if (!info) return 0;
	obj_t reason = __CFStringMakeConstantString("crust-perf-baseline-probe");
	unsigned long long options = 0x00FFFFFFULL | 0xFF00000000000000ULL;
	obj_t activity = ((obj_t (*)(void *, void *, unsigned long long, obj_t))objc_msgSend)(
	    info, sel_registerName("beginActivityWithOptions:reason:"), options, reason);
	if (!activity) return 0;
	((void (*)(void *, void *))objc_msgSend)(activity, sel_registerName("retain"));
	perf_activity = activity;
	return 1;
}
