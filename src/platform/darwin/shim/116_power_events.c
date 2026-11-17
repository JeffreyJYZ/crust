// --- power events: the six notifications crust:power pushes, part two --------
// Joined with 105_power.c into ONE translation unit by power-ffi.ts. No framework header: every
// class, selector and notification name is looked up by string, and one function-pointer sink carries
// the event kind back to bun:ffi. A runtime NSObject subclass is the observer, because a notification
// center does not retain its observers and a stack object would vanish. Every selector calls the one
// sink with a scalar kind (1 sleep, 2 lock, 3 wake, 4 screensleep, 5 screenwake, 6 unlock); no object
// or struct crosses the boundary.
// One observer object carries all six selectors, and it is built from the table below rather than
// from six hand-written registrations: a second observer class would double the objects AppKit keeps
// alive for one page's subscriptions.

extern pw_t objc_msgSend(void *self, void *sel, ...);
extern pw_t objc_getClass(const char *name);
extern pw_t sel_registerName(const char *name);
extern pw_t objc_allocateClassPair(void *superclass, const char *name, unsigned long extra);
extern void objc_registerClassPair(void *cls);
extern int class_addMethod(void *cls, void *sel, void *imp, const char *types);

#define PW_SLEEP 1
#define PW_LOCK 2
#define PW_WAKE 3
#define PW_SCREENSLEEP 4
#define PW_SCREENWAKE 5
#define PW_UNLOCK 6

static int (*pw_event_sink)(int kind) = 0;
static void *pw_observer;
static unsigned pw_watching;

void crust_power_set_sink(void *sink) { pw_event_sink = (int (*)(int))sink; }

static void pw_report(int kind) {
	if (pw_event_sink) pw_event_sink(kind);
}

#define PW_CALLBACK(fn, kind)                              \
	static void fn(void *self, void *cmd, void *note) {    \
		(void)self;                                        \
		(void)cmd;                                         \
		(void)note;                                        \
		pw_report(kind);                                   \
	}

PW_CALLBACK(pw_on_sleep, PW_SLEEP)
PW_CALLBACK(pw_on_lock, PW_LOCK)
PW_CALLBACK(pw_on_wake, PW_WAKE)
PW_CALLBACK(pw_on_screen_sleep, PW_SCREENSLEEP)
PW_CALLBACK(pw_on_screen_wake, PW_SCREENWAKE)
PW_CALLBACK(pw_on_unlock, PW_UNLOCK)

// One row per notification: the kind the sink receives, the notification name, the selector AppKit
// calls, and which center posts it. `distributed` is 1 for the lock pair, which Apple only posts on
// the distributed center; wake and the screen pair come from NSWorkspace.
typedef struct {
	int kind;
	const char *name;
	const char *selector;
	void *imp;
	int distributed;
} pw_watch_t;

static const pw_watch_t pw_watches[] = {
    {PW_SLEEP, "NSWorkspaceWillSleepNotification", "systemWillSleep:", (void *)pw_on_sleep, 0},
    {PW_WAKE, "NSWorkspaceDidWakeNotification", "systemDidWake:", (void *)pw_on_wake, 0},
    {PW_SCREENSLEEP, "NSWorkspaceScreensDidSleepNotification", "screensDidSleep:",
     (void *)pw_on_screen_sleep, 0},
    {PW_SCREENWAKE, "NSWorkspaceScreensDidWakeNotification", "screensDidWake:",
     (void *)pw_on_screen_wake, 0},
    {PW_LOCK, "com.apple.screenIsLocked", "screenDidLock:", (void *)pw_on_lock, 1},
    {PW_UNLOCK, "com.apple.screenIsUnlocked", "screenDidUnlock:", (void *)pw_on_unlock, 1},
};

static const unsigned pw_watch_count = sizeof(pw_watches) / sizeof(pw_watches[0]);

// The row for a kind, or 0 when the OS has no such notification. Keeps `crust_power_watch` and the
// class builder reading the same table, so a name can never be registered without a selector.
static const pw_watch_t *pw_watch_for(int kind) {
	for (unsigned i = 0; i < pw_watch_count; i++)
		if (pw_watches[i].kind == kind) return &pw_watches[i];
	return 0;
}

// The observer class, built once and reused. 0 when NSObject is absent or any callback could not be
// added — the same probe `crust_power_event_class_ready` reports without registering.
static void *pw_observer_object(void) {
	if (pw_observer) return pw_observer;
	void *cls = objc_getClass("CrustPowerObserver");
	if (!cls) {
		void *super = objc_getClass("NSObject");
		if (!super) return 0;
		cls = objc_allocateClassPair(super, "CrustPowerObserver", 0);
		if (!cls) return 0;
		for (unsigned i = 0; i < pw_watch_count; i++) {
			if (!class_addMethod(cls, sel_registerName(pw_watches[i].selector),
			                     pw_watches[i].imp, "v@:@"))
				return 0;
		}
		objc_registerClassPair(cls);
	}
	pw_observer = ((pw_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("new"));
	return pw_observer;
}

// 1 when every delegate callback is installed, 0 when the observer class could not be built.
int crust_power_event_class_ready(void) { return pw_observer_object() ? 1 : 0; }

// The center that posts a row's notification: NSWorkspace's own, or the distributed one.
static void *pw_center(const pw_watch_t *watch) {
	if (watch->distributed)
		return ((pw_t (*)(void *, void *))objc_msgSend)(
		    objc_getClass("NSDistributedNotificationCenter"), sel_registerName("defaultCenter"));
	void *workspace = ((pw_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSWorkspace"),
	                                                          sel_registerName("sharedWorkspace"));
	return workspace ? ((pw_t (*)(void *, void *))objc_msgSend)(
	                       workspace, sel_registerName("notificationCenter"))
	                 : 0;
}

// Add one observer to a notification center. The name is a CFString, toll-free bridged to NSString.
static int pw_add(void *center, const char *name, const char *selector) {
	if (!center) return 0;
	void *observer = pw_observer_object();
	if (!observer) return 0;
	pw_t notification = __CFStringMakeConstantString(name);
	if (!notification) return 0;
	((void (*)(void *, void *, void *, void *, void *, void *))objc_msgSend)(
	    center, sel_registerName("addObserver:selector:name:object:"), observer,
	    sel_registerName(selector), notification, 0);
	return 1;
}

// Register the notification for one kind. Idempotent: a second page arming the same event reuses the
// first observer. 0 means the OS has no such center or no such kind, which the JS side reports as a
// refusal rather than a listener that never fires.
int crust_power_watch(int kind) {
	if (!pw_observer_object()) return 0;
	const pw_watch_t *watch = pw_watch_for(kind);
	if (!watch) return 0;
	unsigned bit = 1u << (unsigned)(kind - 1);
	if (pw_watching & bit) return 1;
	if (!pw_add(pw_center(watch), watch->name, watch->selector)) return 0;
	pw_watching |= bit;
	return 1;
}
