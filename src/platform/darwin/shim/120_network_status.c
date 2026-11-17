// --- network status: SCNetworkReachability, its own unit --------------------
// Compiled by network-status-ffi.ts with -framework SystemConfiguration. No framework header: every
// function is a hand-written prototype, which is how TinyCC compiles this with no SDK.
// Two facts decide the shape. Reachability answers a path, not a byte: a captive portal still reads
// online, and that is the honest answer to "is there a network" rather than to "did a request work".
// And the observer must be scheduled on a dispatch queue, so the sink runs on the main thread the
// pump already drives — the same thread NSWorkspace notifications arrive on.

extern void *SCNetworkReachabilityCreateWithName(void *alloc, const char *name);
extern int SCNetworkReachabilityGetFlags(void *target, unsigned int *flags);
extern int SCNetworkReachabilitySetCallback(void *target, void *callback, void *context);
extern int SCNetworkReachabilityScheduleWithRunLoop(void *target, void *runLoop, void *mode);
extern void *CFRunLoopGetMain(void);
extern void *__CFStringMakeConstantString(const char *str);

extern void *SCNetworkInterfaceCopyAll(void);
extern void *SCNetworkInterfaceGetInterfaceType(void *interface);
extern long CFArrayGetCount(void *array);
extern void *CFArrayGetValueAtIndex(void *array, long index);
extern int CFStringGetCString(void *string, char *buffer, long size, unsigned int encoding);

#define NS_UTF8 0x08000100

// A name that never resolves is deliberate: creation with a name touches no DNS, and the flags are
// about a path to that address, not about whether it answered.
static void *ns_target;
static int (*ns_sink)(int flags) = 0;

static void ns_callback(void *target, unsigned int flags, void *info) {
	(void)target;
	(void)info;
	if (ns_sink) ns_sink((int)flags);
}

int ns_abi(void) { return 1; }

// 1 when a reachability target exists, 0 when SystemConfiguration refused one.
int ns_open(void) {
	if (ns_target) return 1;
	ns_target = SCNetworkReachabilityCreateWithName(0, "crust-status.invalid");
	return ns_target ? 1 : 0;
}

// The raw SCNetworkReachabilityFlags of the current path, or -1 when the OS does not answer.
// JS owns the bit meanings, so a flag change needs no C change.
int ns_flags(void) {
	if (!ns_open()) return -1;
	unsigned int flags = 0;
	if (!SCNetworkReachabilityGetFlags(ns_target, &flags)) return -1;
	return (int)flags;
}

void ns_set_sink(void *sink) { ns_sink = (int (*)(int))sink; }

// Install the observer on the main run loop — the one the pump already drives, so the sink lands on
// the thread AppKit uses and no dispatch queue has to be linked. `SCNetworkReachabilitySetDispatchQueue`
// is the other option and costs libdispatch, which TinyCC does not resolve here (measured 2026-11-17:
// `unresolved reference to '_dispatch_get_main_queue'`). 0 names the step that refused.
int ns_watch(void) {
	if (!ns_open()) return 0;
	if (!SCNetworkReachabilitySetCallback(ns_target, (void *)ns_callback, 0)) return 0;
	void *mode = __CFStringMakeConstantString("kCFRunLoopDefaultMode");
	if (!SCNetworkReachabilityScheduleWithRunLoop(ns_target, CFRunLoopGetMain(), mode)) return 0;
	return 1;
}

// The interface kinds this machine has, as a comma-joined list in `dst`: wifi, wired, cellular,
// other. Reachability's own flags name no interface, and guessing one from a BSD name would be a
// lookup table that goes stale, so the types come from SystemConfiguration instead.
// Returns the byte length written, or -1 when the array could not be read.
int ns_kinds(char *dst, int cap) {
	if (!dst || cap < 2) return -1;
	void *all = SCNetworkInterfaceCopyAll();
	dst[0] = 0;
	if (!all) return 0;
	long count = CFArrayGetCount(all);
	long written = 0;
	int sawWifi = 0, sawWired = 0, sawCell = 0, sawOther = 0;
	for (long index = 0; index < count; index++) {
		void *iface = CFArrayGetValueAtIndex(all, index);
		if (!iface) continue;
		void *type = SCNetworkInterfaceGetInterfaceType(iface);
		char buffer[64];
		buffer[0] = 0;
		if (!type || !CFStringGetCString(type, buffer, 64, NS_UTF8)) continue;
		if (buffer[0] == 'I' && buffer[1] == 'E') { sawWifi = 1; continue; }
		if (buffer[0] == 'E' && buffer[1] == 't') { sawWired = 1; continue; }
		if (buffer[0] == 'W' && buffer[1] == 'W') { sawCell = 1; continue; }
		sawOther = 1;
	}
	const char *order[4];
	int flags[4];
	order[0] = "wifi"; flags[0] = sawWifi;
	order[1] = "wired"; flags[1] = sawWired;
	order[2] = "cellular"; flags[2] = sawCell;
	order[3] = "other"; flags[3] = sawOther;
	for (int index = 0; index < 4; index++) {
		if (!flags[index]) continue;
		const char *word = order[index];
		if (written > 0) {
			if (written + 1 >= cap) break;
			dst[written++] = ',';
		}
		for (int at = 0; word[at]; at++) {
			if (written + 1 >= cap) break;
			dst[written++] = word[at];
		}
	}
	dst[written] = 0;
	return (int)written;
}
