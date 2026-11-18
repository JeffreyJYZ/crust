// --- downloads: prelude, shared by the four parts of this unit --------------
// One translation unit, compiled by platform/darwin/downloads.ts as prelude + block + delegate +
// api, because the parts share statics and a static is private to its unit. It never joins the
// window shim: a download needs WebKit and nothing else. The shim's four rules hold — one fixed
// prototype per objc_msgSend, no framework header, no object and no struct across bun:ffi, and
// every string built from bytes on this side.

typedef void *obj_t;

extern obj_t objc_msgSend(void *self, void *sel, ...);
extern obj_t objc_getClass(const char *name);
extern obj_t sel_registerName(const char *name);
extern void *objc_allocateClassPair(void *superclass, const char *name, unsigned long extra);
extern void objc_registerClassPair(void *cls);
extern int class_addMethod(void *cls, void *name, void *imp, const char *types);
extern void _NSConcreteGlobalBlock;
extern void _NSConcreteStackBlock;
extern void objc_disposeClassPair(void *cls);

#define DL_SLOTS 32
#define DL_TEXT 1024
#define DL_PATH 1024

// What one sink call carries: 0 asks JavaScript for a destination, 1 finished, 2 failed.
#define DL_ASK 0
#define DL_FINISHED 1
#define DL_FAILED 2

static obj_t dl_downloads[DL_SLOTS];
static long long dl_tokens[DL_SLOTS];
static long long dl_next_token;
static int dl_started_count;
static char dl_text[DL_TEXT];
static char dl_destination[DL_PATH];
static long dl_destination_len;
static long long dl_last_token;
static obj_t dl_delegate_class;
static obj_t dl_delegate;
static void *dl_sink;

static void dl_copy(char *into, long cap, const char *text) {
	long i = 0;
	if (!text) {
		into[0] = 0;
		return;
	}
	while (text[i] && i < cap - 1) {
		into[i] = text[i];
		i++;
	}
	into[i] = 0;
}

static const char *dl_utf8(obj_t text) {
	if (!text) return 0;
	return ((const char *(*)(void *, void *))objc_msgSend)(text, sel_registerName("UTF8String"));
}

static obj_t dl_nsstring(const char *bytes, long len) {
	obj_t allocd = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSString"),
	                                                        sel_registerName("alloc"));
	if (!allocd) return 0;
	return ((obj_t (*)(void *, void *, const char *, unsigned long, long long))objc_msgSend)(
	    allocd, sel_registerName("initWithBytes:length:encoding:"), bytes, (unsigned long)len, 4LL);
}

// Ownership rule: dl_nsstring answers a +1 object, so every caller balances it with one of these.
// Never hand a Cocoa object to free(): Bun owns the C allocator here (the Linux shim's GLib trap)
// and a Cocoa object needs its own teardown. Measured 2026-11-18: dl_start and dl_file_url dropped
// the string they handed to NSURL, so every download leaked one NSString.
static void dl_release(obj_t object) {
	if (object) ((void (*)(void *, void *))objc_msgSend)(object, sel_registerName("release"));
}

static obj_t dl_file_url(const char *bytes, long len) {
	obj_t path = dl_nsstring(bytes, len);
	obj_t url;
	if (!path) return 0;
	url = ((obj_t (*)(void *, void *, obj_t))objc_msgSend)(objc_getClass("NSURL"),
	                                                       sel_registerName("fileURLWithPath:"),
	                                                       path);
	// NSURL copies the path into itself; balance our +1 on both the success and the nil-URL path.
	dl_release(path);
	return url;
}

// The slot holding a token, the slot holding an object, and the first free slot.
static long dl_slot(long long token) {
	long i;
	for (i = 0; i < DL_SLOTS; i++)
		if (dl_downloads[i] && dl_tokens[i] == token) return i;
	return -1;
}

static long dl_slot_of(obj_t download) {
	long i;
	for (i = 0; i < DL_SLOTS; i++)
		if (dl_downloads[i] == download) return i;
	return -1;
}

static long dl_free_slot(void) {
	long i;
	for (i = 0; i < DL_SLOTS; i++)
		if (!dl_downloads[i]) return i;
	return -1;
}
