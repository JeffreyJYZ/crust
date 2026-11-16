// --- dock: the application dock tile, for crust:dock -------------------------
// Compiled by platform/darwin/dock.ts. The shim's four rules hold: one fixed prototype per
// objc_msgSend, no framework header, no object and no struct across bun:ffi, and every string built
// from bytes on this side, because a short ASCII NSString is a tagged pointer.
// Progress is done entirely here — the NSProgressIndicator is built, installed and updated in C, so
// the dock tile's content view never becomes a value bun:ffi could be handed.

typedef void *dock_t;

extern dock_t objc_msgSend(void *self, void *sel, ...);
extern dock_t objc_getClass(const char *name);
extern dock_t sel_registerName(const char *name);

typedef struct {
	double x;
	double y;
	double width;
	double height;
} dock_rect;

// The last answer, for a caller that wants a reason. Static storage: valid until the next call.
static char dock_reason[256];

static void dock_reason_set(const char *text) {
	long i = 0;
	while (text[i] && i < 255) {
		dock_reason[i] = text[i];
		i++;
	}
	dock_reason[i] = 0;
}

const char *crust_dock_reason(void) { return dock_reason; }

// Proves the unit linked: a caller reads it and knows the C half is really there.
int crust_dock_abi(void) { return 1; }

// NSString from a byte range. Encoding 4 is NSUTF8StringEncoding; a JS string cannot cross, so the
// badge text arrives as bytes and never as an object.
static dock_t dock_nsstring(const char *bytes, long len) {
	dock_t allocd = ((dock_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSString"),
	                                                           sel_registerName("alloc"));
	if (!allocd) return 0;
	return ((dock_t (*)(void *, void *, const char *, unsigned long, long long))objc_msgSend)(
	    allocd, sel_registerName("initWithBytes:length:encoding:"), bytes, (unsigned long)len, 4LL);
}

// +[NSApplication sharedApplication] — nil on a system with no AppKit.
static dock_t dock_app(void) {
	dock_t cls = objc_getClass("NSApplication");
	if (!cls) return 0;
	return ((dock_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("sharedApplication"));
}

// -[NSApplication dockTile] — nil before the app owns a tile.
static dock_t dock_tile(void) {
	dock_t app = dock_app();
	if (!app) return 0;
	return ((dock_t (*)(void *, void *))objc_msgSend)(app, sel_registerName("dockTile"));
}

// NSRequestUserAttentionType: NSCriticalRequest is 0 and NSInformationalRequest is 10. Exported so a
// test can prove the mapping without bouncing the dock of whoever is at the machine.
int crust_dock_bounce_kind(int critical) { return critical ? 0 : 10; }

// -[NSDockTile setBadgeLabel:] with an empty string, which is how AppKit clears a badge.
int crust_dock_set_badge(const char *bytes, long len) {
	if (!bytes && len > 0) {
		dock_reason_set("the badge text arrived without bytes");
		return 0;
	}
	dock_t tile = dock_tile();
	if (!tile) {
		dock_reason_set("NSApplication has no dock tile");
		return 0;
	}
	dock_t label = dock_nsstring(bytes, len);
	if (!label) {
		dock_reason_set("the badge text did not become a string");
		return 0;
	}
	((void (*)(void *, void *, dock_t))objc_msgSend)(tile, sel_registerName("setBadgeLabel:"), label);
	dock_reason_set(len == 0 ? "badge cleared" : "badge set");
	return 1;
}

// -[NSDockTile badgeLabel], copied into static storage. Empty when there is no tile or no badge.
static char dock_label[256];

const char *crust_dock_badge_label(void) {
	dock_label[0] = 0;
	dock_t tile = dock_tile();
	if (!tile) return dock_label;
	dock_t text = ((dock_t (*)(void *, void *))objc_msgSend)(tile, sel_registerName("badgeLabel"));
	if (!text) return dock_label;
	const char *(*utf8)(void *, void *) = (const char *(*)(void *, void *))objc_msgSend;
	const char *bytes = utf8(text, sel_registerName("UTF8String"));
	if (!bytes) return dock_label;
	long i = 0;
	while (bytes[i] && i < 255) {
		dock_label[i] = bytes[i];
		i++;
	}
	dock_label[i] = 0;
	return dock_label;
}

// -[NSApplication requestUserAttention:] answers a request id; -1 means AppKit was unreachable, so
// it can never be mistaken for the id 0 that a first request really returns.
long crust_dock_bounce(int critical) {
	dock_t app = dock_app();
	if (!app) {
		dock_reason_set("NSApplication is not reachable");
		return -1;
	}
	long kind = (long)crust_dock_bounce_kind(critical);
	long request = (long)((long (*)(void *, void *, long))objc_msgSend)(
	    app, sel_registerName("requestUserAttention:"), kind);
	dock_reason_set(critical ? "critical bounce requested" : "informational bounce requested");
	return request;
}

// The indicator this unit installed, if any. Owned here for the process, never freed: a dock tile
// holding a released view is a crash inside AppKit with no JavaScript error to report.
static dock_t dock_progress = 0;

// A bar across the bottom of the 128-point tile. Everything below stays in C, so the content view is
// never an object bun:ffi holds.
int crust_dock_set_progress(double value) {
	if (!(value >= 0.0 && value <= 1.0)) {
		dock_reason_set("progress is a fraction between 0 and 1");
		return 0;
	}
	dock_t tile = dock_tile();
	if (!tile) {
		dock_reason_set("NSApplication has no dock tile");
		return 0;
	}
	if (!dock_progress) {
		dock_t cls = objc_getClass("NSProgressIndicator");
		if (!cls) {
			dock_reason_set("NSProgressIndicator is not reachable");
			return 0;
		}
		dock_t allocated = ((dock_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("alloc"));
		if (!allocated) {
			dock_reason_set("NSProgressIndicator could not be allocated");
			return 0;
		}
		dock_rect frame;
		frame.x = 0.0;
		frame.y = 0.0;
		frame.width = 128.0;
		frame.height = 18.0;
		dock_progress = ((dock_t (*)(void *, void *, dock_rect))objc_msgSend)(
		    allocated, sel_registerName("initWithFrame:"), frame);
		if (!dock_progress) {
			dock_reason_set("NSProgressIndicator could not be initialised");
			return 0;
		}
		// NSProgressIndicatorStyleBar is 0, and a determinate bar needs min 0, max 1.
		((void (*)(void *, void *, long))objc_msgSend)(dock_progress, sel_registerName("setStyle:"),
		                                               0L);
		((void (*)(void *, void *, char))objc_msgSend)(dock_progress,
		                                               sel_registerName("setIndeterminate:"), 0);
		((void (*)(void *, void *, double))objc_msgSend)(dock_progress,
		                                                 sel_registerName("setMinValue:"), 0.0);
		((void (*)(void *, void *, double))objc_msgSend)(dock_progress,
		                                                 sel_registerName("setMaxValue:"), 1.0);
		((void (*)(void *, void *, dock_t))objc_msgSend)(tile, sel_registerName("setContentView:"),
		                                                 dock_progress);
	}
	((void (*)(void *, void *, double))objc_msgSend)(dock_progress,
	                                                 sel_registerName("setDoubleValue:"), value);
	dock_reason_set("progress set");
	return 1;
}
