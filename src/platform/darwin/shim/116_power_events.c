// --- power events: sleep and lock notifications, part two -------------------
// Joined with 105_power.c into ONE translation unit by power-ffi.ts. No framework header: every
// class, selector and notification name is looked up by string, and one function-pointer sink carries
// the event kind back to bun:ffi. A runtime NSObject subclass is the observer, because a notification
// center does not retain its observers and a stack object would vanish. Both selectors call the one
// sink with a scalar kind (1 sleep, 2 lock); no object or struct crosses the boundary.

extern pw_t objc_msgSend(void *self, void *sel, ...);
extern pw_t objc_getClass(const char *name);
extern pw_t sel_registerName(const char *name);
extern pw_t objc_allocateClassPair(void *superclass, const char *name, unsigned long extra);
extern void objc_registerClassPair(void *cls);
extern int class_addMethod(void *cls, void *sel, void *imp, const char *types);

#define PW_SLEEP 1
#define PW_LOCK 2

static int (*pw_event_sink)(int kind) = 0;
static void *pw_observer;
static int pw_watching;

void crust_power_set_sink(void *sink) { pw_event_sink = (int (*)(int))sink; }

static void pw_report(int kind) {
	if (pw_event_sink) pw_event_sink(kind);
}

static void pw_will_sleep(void *self, void *cmd, void *note) {
	(void)self;
	(void)cmd;
	(void)note;
	pw_report(PW_SLEEP);
}

static void pw_screen_locked(void *self, void *cmd, void *note) {
	(void)self;
	(void)cmd;
	(void)note;
	pw_report(PW_LOCK);
}

// The observer class, built once and reused. 0 when NSObject is absent or either callback could
// not be added — the same probe `crust_power_event_class_ready` reports without registering.
static void *pw_observer_object(void) {
	if (pw_observer) return pw_observer;
	void *cls = objc_getClass("CrustPowerObserver");
	if (!cls) {
		void *super = objc_getClass("NSObject");
		if (!super) return 0;
		cls = objc_allocateClassPair(super, "CrustPowerObserver", 0);
		if (!cls) return 0;
		if (!class_addMethod(cls, sel_registerName("systemWillSleep:"), (void *)pw_will_sleep, "v@:@"))
			return 0;
		if (!class_addMethod(cls, sel_registerName("screenDidLock:"), (void *)pw_screen_locked, "v@:@"))
			return 0;
		objc_registerClassPair(cls);
	}
	pw_observer = ((pw_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("new"));
	return pw_observer;
}

// 1 when both delegate callbacks are installed, 0 when the observer class could not be built.
int crust_power_event_class_ready(void) { return pw_observer_object() ? 1 : 0; }

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
// first observer. 0 means the OS has no such center, which the JS side reports as a refusal.
int crust_power_watch(int kind) {
	if (!pw_observer_object()) return 0;
	if (kind == PW_SLEEP) {
		if (pw_watching & 1) return 1;
		void *workspace = ((pw_t (*)(void *, void *))objc_msgSend)(
		    objc_getClass("NSWorkspace"), sel_registerName("sharedWorkspace"));
		void *center = workspace
		                   ? ((pw_t (*)(void *, void *))objc_msgSend)(
		                         workspace, sel_registerName("notificationCenter"))
		                   : 0;
		if (!pw_add(center, "NSWorkspaceWillSleepNotification", "systemWillSleep:")) return 0;
		pw_watching |= 1;
		return 1;
	}
	if (kind == PW_LOCK) {
		if (pw_watching & 2) return 1;
		void *center = ((pw_t (*)(void *, void *))objc_msgSend)(
		    objc_getClass("NSDistributedNotificationCenter"), sel_registerName("defaultCenter"));
		if (!pw_add(center, "com.apple.screenIsLocked", "screenDidLock:")) return 0;
		pw_watching |= 2;
		return 1;
	}
	return 0;
}

