// --- QuickLook preview: prelude, primitive sends and the file list -----------
// First of four parts (`126_preview_data.c`, `127_preview_panel.c`, `128_preview_probe.c`), joined
// by platform/darwin/preview-unit.ts into one translation unit and never compiled by the window
// shim: QuickLookUI is a framework the shim does not link.
// The shim's four rules hold — one fixed prototype per objc_msgSend, no framework header, no object
// and no struct across bun:ffi, and every path arrives as bytes and becomes an NSString on this
// side, because a short ASCII NSString is a tagged pointer that cannot cross the boundary.

typedef void *pv_t;
typedef void (*pv_imp)(void);

extern pv_t objc_msgSend(void *self, void *sel, ...);
extern pv_t objc_getClass(const char *name);
extern pv_t sel_registerName(const char *name);
extern void *class_getInstanceMethod(void *cls, void *sel);
extern void *class_getInstanceVariable(void *cls, const char *name);
extern long ivar_getOffset(void *ivar);
extern pv_t objc_allocateClassPair(void *superclass, const char *name, unsigned long extra);
extern void objc_registerClassPair(void *cls);
extern int class_addMethod(void *cls, void *sel, pv_imp imp, const char *types);
extern int class_addIvar(void *cls, const char *name, unsigned long size, unsigned char alignment,
                         const char *types);

// A panel's size, built on the C stack: a struct never crosses bun:ffi.
typedef struct {
	double width;
	double height;
} pv_size;

// Mirrored by PREVIEW_STATUS in preview-unit.ts.
#define SHIM_PREVIEW_OK 0
#define SHIM_PREVIEW_UNAVAILABLE 1
#define SHIM_PREVIEW_NO_PATHS 2
#define SHIM_PREVIEW_REFUSED 3

#define SHIM_PREVIEW_MAX_PATHS 32
#define SHIM_PREVIEW_PATH_BYTES 2048

// The panel's file list, in C exactly as the open panel's is: a JS array cannot cross, so paths
// arrive newline-separated and are read back by index. The data source IMPs answer from this array,
// which is why it is static rather than per-call.
static char preview_paths[SHIM_PREVIEW_MAX_PATHS][SHIM_PREVIEW_PATH_BYTES];
static int preview_paths_used;

static char preview_reason[256];

// The window the panel was shown over. Declared with the shared state because the observer reads it
// as well as the panel. crust keeps a closed window addressable (`setReleasedWhenClosed: 0`), so this
// pointer stays valid after the close, which is what makes the liveness read safe.
static pv_t preview_owner;

static void preview_reason_set(const char *text) {
	long i = 0;
	while (text[i] && i < 255) {
		preview_reason[i] = text[i];
		i++;
	}
	preview_reason[i] = 0;
}

const char *shim_preview_reason(void) { return preview_reason; }

// --- primitive sends --------------------------------------------------------

static pv_t pv_msg0(pv_t obj, const char *sel) {
	return ((pv_t (*)(void *, void *))objc_msgSend)(obj, sel_registerName(sel));
}

static pv_t pv_msg1(pv_t obj, const char *sel, pv_t arg) {
	return ((pv_t (*)(void *, void *, pv_t))objc_msgSend)(obj, sel_registerName(sel), arg);
}

// An NSString from a NUL-terminated path. Encoding 4 is NSUTF8StringEncoding.
static pv_t pv_nsstring(const char *s) {
	if (!s || !s[0]) return 0;
	pv_t allocd = pv_msg0(objc_getClass("NSString"), "alloc");
	if (!allocd) return 0;
	long len = 0;
	while (s[len]) len++;
	return ((pv_t (*)(void *, void *, const char *, unsigned long, long long))objc_msgSend)(
	    allocd, sel_registerName("initWithBytes:length:encoding:"), s, (unsigned long)len, 4LL);
}

// `+[NSURL fileURLWithPath:]`: the URL is built here and read by QuickLook, so it never crosses.
static pv_t pv_file_url(const char *path) {
	pv_t text = pv_nsstring(path);
	if (!text) return 0;
	pv_t cls = objc_getClass("NSURL");
	if (!cls) return 0;
	return pv_msg1(cls, "fileURLWithPath:", text);
}

static int pv_class_responds(pv_t cls, const char *sel) {
	if (!cls) return 0;
	return (int)(char)((char (*)(void *, void *, void *))objc_msgSend)(
	    cls, sel_registerName("respondsToSelector:"), sel_registerName(sel));
}

// Every instance selector this unit sends, checked before the send: an uncaught ObjC exception
// terminates the process with SIGABRT and no JavaScript error.
static int pv_has(const char *clsname, const char *sel) {
	void *cls = objc_getClass(clsname);
	if (!cls) return 0;
	return class_getInstanceMethod(cls, sel_registerName(sel)) != 0;
}

// --- the file list ----------------------------------------------------------

// Newline-separated bytes into static storage: one allocation-free copy, so a caller can hand over
// a whole list and read it back by index. A path longer than the slot is truncated rather than
// dropped, because a dropped path previews the wrong file.
int shim_preview_set_paths(const char *bytes, int len) {
	preview_paths_used = 0;
	if (!bytes || len <= 0) return 0;
	int start = 0;
	for (int i = 0; i <= len && preview_paths_used < SHIM_PREVIEW_MAX_PATHS; i++) {
		if (i != len && bytes[i] != '\n') continue;
		int n = i - start;
		if (n > 0) {
			char *dst = preview_paths[preview_paths_used];
			int copied = 0;
			for (int j = 0; j < n && copied < SHIM_PREVIEW_PATH_BYTES - 1; j++)
				dst[copied++] = bytes[start + j];
			dst[copied] = 0;
			preview_paths_used++;
		}
		start = i + 1;
	}
	return preview_paths_used;
}

int shim_preview_count(void) { return preview_paths_used; }

const char *shim_preview_path(int index) {
	if (index < 0 || index >= preview_paths_used) return "";
	return preview_paths[index];
}
