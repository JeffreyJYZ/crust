// --- single instance -------------------------------------------------------
// Compiled on its own by `platform/darwin/single.ts`, not joined into the window
// shim, because a second launch must raise the first one before any window exists.
// The file therefore carries its own externs; nothing but an int crosses either way.

extern void *objc_msgSend(void *self, void *sel, ...);
extern void *objc_getClass(const char *name);
extern void *sel_registerName(const char *name);

// NSApplicationActivateAllWindows | NSApplicationActivateIgnoringOtherApps.
#define SHIM_SINGLE_ACTIVATE_OPTIONS 3UL

// Status: 0 the system took the activation, 1 no such running application,
// 2 AppKit is missing a class or selector, 3 the system refused it, 4 bad pid.
int shim_single_activate(long pid) {
	if (pid <= 0 || pid > 2147483647L) return 4;
	void *cls = objc_getClass("NSRunningApplication");
	void *byPid = sel_registerName("runningApplicationWithProcessIdentifier:");
	if (!cls || !byPid) return 2;
	void *app = ((void *(*)(void *, void *, int))objc_msgSend)(cls, byPid, (int)pid);
	if (!app) return 1;
	void *activate = sel_registerName("activateWithOptions:");
	if (!activate) return 2;
	int ok = (int)((signed char (*)(void *, void *, unsigned long))objc_msgSend)(
	    app, activate, SHIM_SINGLE_ACTIVATE_OPTIONS);
	return ok ? 0 : 3;
}
