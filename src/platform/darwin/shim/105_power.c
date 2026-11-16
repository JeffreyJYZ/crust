// --- power: battery, idle time and sleep assertions, for crust:power ---------
// Compiled by platform/darwin/power.ts. IOKit, CoreGraphics and Foundation are linked by name and no
// framework header is included; every value crosses bun:ffi as a number, and the assertion id is the
// only handle, never an object.
// The assertion is held in this translation unit's static storage, so `crust_power_allow_sleep` can
// always find it again, and the OS drops it when the process exits even if nobody called release.

typedef void *pw_t;

extern pw_t objc_msgSend(void *self, void *sel, ...);
extern pw_t objc_getClass(const char *name);
extern pw_t sel_registerName(const char *name);
extern pw_t __CFStringMakeConstantString(const char *cstr);
extern pw_t CFStringCreateWithBytes(pw_t alloc, const unsigned char *bytes, long num_bytes,
                                    unsigned int encoding, int external);
extern void CFRelease(pw_t cf);
extern long CFArrayGetCount(pw_t array);
extern pw_t CFArrayGetValueAtIndex(pw_t array, long index);
extern pw_t CFDictionaryGetValue(pw_t dict, pw_t key);
extern int CFNumberGetValue(pw_t number, int type, void *value);
extern int CFStringGetCString(pw_t s, char *buf, long size, unsigned int encoding);
extern pw_t IOPSCopyPowerSourcesInfo(void);
extern pw_t IOPSCopyPowerSourcesList(pw_t blob);
extern pw_t IOPSGetPowerSourceDescription(pw_t blob, pw_t source);
extern int IOPMAssertionCreateWithName(pw_t type, unsigned int level, pw_t name, unsigned int *id);
extern int IOPMAssertionRelease(unsigned int id);
extern double CGEventSourceSecondsSinceLastEventType(int state, unsigned int event_type);

#define PW_UTF8 0x08000100 /* kCFStringEncodingUTF8 */
#define PW_NUMBER_DOUBLE 13 /* kCFNumberDoubleType */

// The last answer, for a caller that wants a reason. Static storage: valid until the next call.
static char pw_reason[256];

static void pw_reason_set(const char *text) {
	long i = 0;
	while (text[i] && i < 255) {
		pw_reason[i] = text[i];
		i++;
	}
	pw_reason[i] = 0;
}

const char *crust_power_reason(void) { return pw_reason; }

// Proves the unit linked: a caller reads it and knows the C half is really there.
int crust_power_abi(void) { return 1; }

static int pw_text_equals(const char *a, const char *b) {
	long i = 0;
	while (a[i] && b[i]) {
		if (a[i] != b[i]) return 0;
		i++;
	}
	return a[i] == b[i];
}

static pw_t pw_key(const char *name) { return __CFStringMakeConstantString(name); }

// Reads the internal battery's state: 1 on AC, 0 on battery, -1 when no battery answered. A machine
// with no battery is on wall power, and that is the honest answer rather than a missing one.
static int pw_battery(double *percent) {
	if (percent) *percent = -1.0;
	pw_t blob = IOPSCopyPowerSourcesInfo();
	if (!blob) return -1;
	int answer = -1;
	pw_t list = IOPSCopyPowerSourcesList(blob);
	if (list) {
		long count = CFArrayGetCount(list);
		for (long i = 0; i < count; i++) {
			pw_t source = CFArrayGetValueAtIndex(list, i);
			if (!source) continue;
			pw_t description = IOPSGetPowerSourceDescription(blob, source);
			if (!description) continue;
			char kind[64];
			pw_t type = CFDictionaryGetValue(description, pw_key("Type"));
			if (!type || !CFStringGetCString(type, kind, 64, PW_UTF8)) continue;
			if (!pw_text_equals(kind, "InternalBattery")) continue;
			char state[64];
			pw_t source_state = CFDictionaryGetValue(description, pw_key("Power Source State"));
			int on_ac = 0;
			if (source_state && CFStringGetCString(source_state, state, 64, PW_UTF8))
				on_ac = pw_text_equals(state, "AC Power");
			pw_t current = CFDictionaryGetValue(description, pw_key("Current Capacity"));
			pw_t maximum = CFDictionaryGetValue(description, pw_key("Max Capacity"));
			double charged = 0.0;
			double capacity = 0.0;
			if (percent && current && maximum &&
			    CFNumberGetValue(current, PW_NUMBER_DOUBLE, &charged) &&
			    CFNumberGetValue(maximum, PW_NUMBER_DOUBLE, &capacity) && capacity > 0.0)
				*percent = (charged / capacity) * 100.0;
			answer = on_ac;
			break;
		}
		CFRelease(list);
	}
	CFRelease(blob);
	return answer;
}

// -[NSProcessInfo isLowPowerModeEnabled] arrived in macOS 12; a selector that is absent answers NO,
// which reads as off, and the reason names which case ran.
static int pw_low_power_mode(void) {
	pw_t cls = objc_getClass("NSProcessInfo");
	if (!cls) return 0;
	pw_t info = ((pw_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("processInfo"));
	if (!info) return 0;
	return (int)(char)((char (*)(void *, void *))objc_msgSend)(
	    info, sel_registerName("isLowPowerModeEnabled"));
}

// Writes onAc (1 on wall power, 0 on battery), the battery percentage (-1 when there is no battery)
// and the low-power flag into out[0..2]. 1 when IOKit answered, 0 when it did not.
int crust_power_state(double *out) {
	if (!out) return 0;
	int battery = -1;
	double percent = -1.0;
	int on_ac = pw_battery(&percent);
	out[0] = on_ac < 0 ? 1.0 : (double)on_ac;
	out[1] = percent;
	out[2] = (double)pw_low_power_mode();
	if (on_ac < 0)
		pw_reason_set("no battery answered, so the process is treated as on wall power");
	else
		pw_reason_set(on_ac ? "on AC power" : "on battery");
	return 1;
}

// kCGEventSourceStateCombinedSessionState is 0 and kCGAnyInputEventType is ~0. Seconds, fractional.
double crust_power_idle_seconds(void) { return CGEventSourceSecondsSinceLastEventType(0, 0xFFFFFFFFu); }

// The assertion this unit holds, or 0 when none is. Static storage, so a release can always find it.
static unsigned int pw_assertion;

// The live assertion id, or 0 when none is held. Exported so a caller can prove a release happened.
int crust_power_held(void) { return (int)pw_assertion; }

// kIOPMAssertionLevelOn is 255, and the type's value is the string IOKit compares against.
int crust_power_prevent_sleep(const char *bytes, long len) {
	if (!bytes || len <= 0) {
		pw_reason_set("a sleep assertion needs a non-empty reason");
		return -1;
	}
	pw_t name = CFStringCreateWithBytes(0, (const unsigned char *)bytes, len, PW_UTF8, 0);
	if (!name) {
		pw_reason_set("the reason did not become a CFString");
		return -1;
	}
	unsigned int id = 0;
	int status = IOPMAssertionCreateWithName(pw_key("PreventUserIdleSystemSleep"), 255u, name, &id);
	CFRelease(name);
	if (status != 0 || id == 0) {
		pw_reason_set("IOPMAssertionCreateWithName refused the assertion");
		return -1;
	}
	pw_assertion = id;
	pw_reason_set("assertion held");
	return (int)id;
}

// 1 released, 0 when nothing was held, -1 when IOKit refused. A refused release keeps the id, so a
// second attempt can still find it rather than losing an assertion the process still owns.
int crust_power_allow_sleep(void) {
	if (pw_assertion == 0) {
		pw_reason_set("no assertion is held");
		return 0;
	}
	int status = IOPMAssertionRelease(pw_assertion);
	if (status != 0) {
		pw_reason_set("IOPMAssertionRelease refused");
		return -1;
	}
	pw_assertion = 0;
	pw_reason_set("assertion released");
	return 1;
}
