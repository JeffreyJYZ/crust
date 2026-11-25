// crust ownership audit — one shared prelude injected into every audited C unit by
// shim-audit.ts. With CRUST_SHIM_AUDIT off the wrappers are the exact Objective-C/CF
// calls they name: no branch, no counter, no extra message. With it on, every owned
// reference is counted so a missing release fails a test instead of a read-only hunt.
//
// +1 paths: crust_own (alloc/init/new/Create already gave the reference, accounting
// only) and crust_retain (a borrowed +0 object pinned with -retain).
// -1 paths: crust_release (-release) and crust_cf_release (CFRelease).

#ifdef CRUST_SHIM_AUDIT

extern void *objc_msgSend(void *self, void *sel, ...);
extern void *sel_registerName(const char *name);
extern void CFRelease(void *object);
extern void CFRetain(void *object);

static int crust_audit_net;
static int crust_audit_events;

#define crust_own(o)                                                     \
	do {                                                                 \
		if (o) {                                                         \
			crust_audit_net++;                                           \
			crust_audit_events++;                                        \
		}                                                                \
	} while (0)
#define crust_cf_own(o) crust_own(o)

static void crust_retain(void *object) {
	if (!object) return;
	crust_audit_net++;
	crust_audit_events++;
	((void (*)(void *, void *))objc_msgSend)(object, sel_registerName("retain"));
}

static void crust_cf_retain(void *object) {
	if (!object) return;
	crust_audit_net++;
	crust_audit_events++;
	CFRetain(object);
}

static void crust_release(void *object) {
	if (!object) return;
	crust_audit_net--;
	((void (*)(void *, void *))objc_msgSend)(object, sel_registerName("release"));
}

static void crust_cf_release(void *object) {
	if (!object) return;
	crust_audit_net--;
	CFRelease(object);
}

int shim_audit_balance(void) { return crust_audit_net; }
int shim_audit_events(void) { return crust_audit_events; }
void shim_audit_reset(void) { crust_audit_net = 0; crust_audit_events = 0; }
void shim_audit_bump(int by) { crust_audit_net += by; }

#else

#define crust_own(o) ((void)0)
#define crust_cf_own(o) ((void)0)
#define crust_retain(o)                                                                       \
	((void)((void (*)(void *, void *))objc_msgSend)((o), sel_registerName("retain")))
#define crust_cf_retain(o) CFRetain((o))
#define crust_release(o)                                                                      \
	((void)((void (*)(void *, void *))objc_msgSend)((o), sel_registerName("release")))
#define crust_cf_release(o) CFRelease((o))

// -1 is the honest "this unit was compiled without the audit" answer. A caller must
// refuse a report with this sentinel rather than treat it as a real balance.
int shim_audit_balance(void) { return -1; }
int shim_audit_events(void) { return -1; }
void shim_audit_reset(void) {}
void shim_audit_bump(int by) { (void)by; }

#endif
