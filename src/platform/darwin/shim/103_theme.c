// --- theme: the appearance an app is drawing in, its own unit ----------------
// Compiled by platform/darwin/theme.ts and deliberately absent from SHIM_PARTS: NSApplication already
// exists by the time a page asks, and nothing here needs the window shim's statics. The shim's four
// rules hold — one fixed prototype per objc_msgSend, no framework header, no object and no struct
// across bun:ffi, and every string built from bytes on this side.

typedef void *th_t;

extern th_t objc_msgSend(void *self, void *sel, ...);
extern th_t objc_getClass(const char *name);
extern th_t sel_registerName(const char *name);
extern th_t __CFStringMakeConstantString(const char *cstr);
extern int CFStringGetCString(void *s, char *buf, long size, unsigned int encoding);

#define TH_UTF8 0x08000100 /* kCFStringEncodingUTF8 */

// The last answer, for a caller that wants a reason. Static storage: valid until the next call.
static char th_reason[256];

static void th_reason_set(const char *text) {
	long i = 0;
	while (text[i] && i < 255) {
		th_reason[i] = text[i];
		i++;
	}
	th_reason[i] = 0;
}

const char *crust_theme_reason(void) { return th_reason; }

// Substring test, because an appearance name carries its variant in the middle:
// "NSAppearanceNameAccessibilityHighContrastDarkAqua" is still a dark appearance, and an array of
// every name would have to cross the boundary as an object.
static int th_has(const char *text, const char *needle) {
	long i = 0;
	while (text[i]) {
		long j = 0;
		while (needle[j] && text[i + j] == needle[j]) j++;
		if (!needle[j]) return 1;
		i++;
	}
	return 0;
}

// +[NSApplication sharedApplication] — nil on a system with no AppKit, which every entry point checks
// before sending anything. NSApp is the same object, read through the class so no AppKit global has to
// resolve at link time.
static th_t th_app(void) {
	th_t cls = objc_getClass("NSApplication");
	if (!cls) return 0;
	return ((th_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("sharedApplication"));
}

// 1 dark, 0 light, -1 unreadable. The effective appearance is what the app draws in, so it already
// accounts for an override set earlier through crust_theme_set.
int crust_theme_current(void) {
	th_t app = th_app();
	if (!app) return -1;
	th_t appearance = ((th_t (*)(void *, void *))objc_msgSend)(app,
	                                                          sel_registerName("effectiveAppearance"));
	if (!appearance) return -1;
	th_t name = ((th_t (*)(void *, void *))objc_msgSend)(appearance, sel_registerName("name"));
	if (!name) return -1;
	char buf[64];
	buf[0] = 0;
	if (!CFStringGetCString(name, buf, 64, TH_UTF8)) return -1;
	if (th_has(buf, "Dark")) return 1;
	if (th_has(buf, "Aqua") || th_has(buf, "Light")) return 0;
	return -1;
}

// 0 light (NSAppearanceNameAqua), 1 dark (NSAppearanceNameDarkAqua), 2 follow the system (nil).
// 1 when AppKit took it, 0 with the reason naming the step that refused.
int crust_theme_set(int appearance) {
	th_t app = th_app();
	if (!app) {
		th_reason_set("NSApplication is not reachable");
		return 0;
	}
	th_t value = 0;
	if (appearance == 0 || appearance == 1) {
		const char *name = appearance == 1 ? "NSAppearanceNameDarkAqua" : "NSAppearanceNameAqua";
		th_t cls = objc_getClass("NSAppearance");
		if (!cls) {
			th_reason_set("NSAppearance is not reachable");
			return 0;
		}
		// A constant string, not a built one: it is interned by CoreFoundation and is never tagged.
		th_t constant = __CFStringMakeConstantString(name);
		if (!constant) {
			th_reason_set("the appearance name did not become a constant string");
			return 0;
		}
		value = ((th_t (*)(void *, void *, th_t))objc_msgSend)(
		    cls, sel_registerName("appearanceNamed:"), constant);
		if (!value) {
			th_reason_set("+[NSAppearance appearanceNamed:] answered nil");
			return 0;
		}
	} else if (appearance != 2) {
		th_reason_set("unknown appearance code");
		return 0;
	}
	((void (*)(void *, void *, th_t))objc_msgSend)(app, sel_registerName("setAppearance:"), value);
	th_reason_set("applied");
	return 1;
}
