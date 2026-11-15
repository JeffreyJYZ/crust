// --- global shortcuts ------------------------------------------------------
// `RegisterEventHotKey` needs no accessibility permission, unlike an NSEvent
// monitor, and delivers through the Carbon application event target. Every symbol
// is a hand-written extern: TinyCC reaches no HIToolbox header, and no Carbon
// struct crosses bun:ffi — the ids stay in C and JS only sees an int.

typedef struct {
	unsigned int signature;
	unsigned int id;
} shortcut_hotkey_id;

extern void *GetApplicationEventTarget(void);
extern long InstallEventHandler(void *target, void *handler, unsigned long types,
                                const void *list, void *user, void **ref);
extern long RegisterEventHotKey(unsigned int keycode, unsigned int modifiers,
                                unsigned long long hotkey, void *target, unsigned int options,
                                void **ref);
extern long UnregisterEventHotKey(void *ref);
extern long GetEventParameter(void *event, unsigned int name, unsigned int type, void *outType,
                              unsigned long size, unsigned long *outSize, void *outData);

// Carbon's constants, spelled out because no header is reachable: 'keyb',
// kEventHotKeyPressed, kEventParamDirectObject ('----') and typeEventHotKeyID.
#define SHORTCUT_CLASS 0x6B657962u
#define SHORTCUT_PRESSED 5u
#define SHORTCUT_PARAM 0x2D2D2D2Du
#define SHORTCUT_TYPE 0x686B6964u
#define SHORTCUT_SIGNATURE 0x43727573u // 'Crus', so a foreign hot key is ignored
#define SHORTCUT_MAX 32

static void *shortcut_imp;
static void *shortcut_handler;
static unsigned int shortcut_ids[SHORTCUT_MAX];
static void *shortcut_refs[SHORTCUT_MAX];
static unsigned int shortcut_next = 1;

int shortcut_abi(void) { return 1; }

// The event handler: read the hot-key id the OS echoed back and hand it to the
// JavaScript callback. A signature mismatch is another app's event, not ours.
static int shortcut_fire(void *call_ref, void *event, void *user) {
	shortcut_hotkey_id got;
	got.signature = 0;
	got.id = 0;
	if (GetEventParameter(event, SHORTCUT_PARAM, SHORTCUT_TYPE, 0, sizeof got, 0, &got) != 0)
		return 0;
	if (got.signature != SHORTCUT_SIGNATURE) return 0;
	if (!shortcut_imp) return 0;
	((int (*)(int))shortcut_imp)((int)got.id);
	return 0;
}

// Install the keyboard handler once. `imp` is the JSCallback bun:ffi handed over;
// without it no hot key can ever report, so it is required before any register.
int shortcut_install(void *imp) {
	if (!imp) return 0;
	shortcut_imp = imp;
	if (shortcut_handler) return 1;
	unsigned int spec[2];
	spec[0] = SHORTCUT_CLASS;
	spec[1] = SHORTCUT_PRESSED;
	long status = InstallEventHandler(GetApplicationEventTarget(), (void *)shortcut_fire, 1, spec, 0,
	                                  &shortcut_handler);
	return status == 0 && shortcut_handler ? 1 : 0;
}

// One hot key, answering its id (>0) or 0. `EventHotKeyID` is {signature, id},
// eight bytes passed in one register on arm64, so it is packed by hand rather
// than pushed through TinyCC's by-value struct path.
int shortcut_register(int keycode, int modifiers) {
	if (!shortcut_imp || !shortcut_handler) return 0;
	for (int i = 0; i < SHORTCUT_MAX; i++) {
		if (shortcut_refs[i]) continue;
		unsigned int id = shortcut_next++;
		if (shortcut_next == 0) shortcut_next = 1;
		unsigned long long packed = ((unsigned long long)id << 32) | SHORTCUT_SIGNATURE;
		void *ref = 0;
		long status = RegisterEventHotKey((unsigned int)keycode, (unsigned int)modifiers, packed,
		                                  GetApplicationEventTarget(), 0, &ref);
		if (status != 0 || !ref) return 0;
		shortcut_ids[i] = id;
		shortcut_refs[i] = ref;
		return (int)id;
	}
	return 0;
}

int shortcut_unregister(int id) {
	for (int i = 0; i < SHORTCUT_MAX; i++) {
		if (!shortcut_refs[i] || (int)shortcut_ids[i] != id) continue;
		long status = UnregisterEventHotKey(shortcut_refs[i]);
		shortcut_refs[i] = 0;
		shortcut_ids[i] = 0;
		return status == 0 ? 1 : 0;
	}
	return 0;
}

// Every hot key, answering how many the OS let go of. The handler stays installed:
// re-installing per registration would leak one handler per cycle.
int shortcut_unregister_all(void) {
	int removed = 0;
	for (int i = 0; i < SHORTCUT_MAX; i++) {
		if (!shortcut_refs[i]) continue;
		if (UnregisterEventHotKey(shortcut_refs[i]) == 0) removed++;
		shortcut_refs[i] = 0;
		shortcut_ids[i] = 0;
	}
	return removed;
}
