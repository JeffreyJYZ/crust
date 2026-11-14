// --- file panels (NSOpenPanel, NSSavePanel) --------------------------------
// No object crosses bun:ffi: a short ASCII NSString is a tagged pointer above 2^53, so URLs are decoded into
// C-side storage and JS reads an int status plus a copied `const char *` (`site/app/docs/design/page.mdx`). Open and save share
// that machinery, differing only in the class, setters and answer read. Status codes, mirrored by PANEL_STATUS:
#define SHIM_PANEL_PICKED 0        // modal pick finished with >= 1 path
#define SHIM_PANEL_CANCELLED 1     // modal pick finished with no path
#define SHIM_PANEL_UNSUPPORTED 2   // NSOpenPanel, or a selector it needs, is absent
#define SHIM_PANEL_SHEET_STARTED 3 // beginSheet... accepted; poll shim_sheet_done()
#define SHIM_PANEL_NO_WINDOW 4     // sheet asked for with no key window
#define SHIM_PANEL_BUSY 5          // a sheet is already up; nothing was sent, nothing was touched

#define SHIM_PANEL_MAX_PATHS 32
#define SHIM_PANEL_PATH_BYTES 4096

static char panel_paths[SHIM_PANEL_MAX_PATHS][SHIM_PANEL_PATH_BYTES];
static int panel_paths_used;

// The sheet's answer, written by the completion handler and read from JS by
// polling: a blocking -runModal stops the JavaScript thread and with it every
// in-flight invoke, while a sheet plus a done flag leaves both running.
//
// SHIM_PANEL_NO_RESPONSE is the "not answered yet" value, chosen because it is
// neither NSModalResponseOK (1) nor NSModalResponseCancel (0).
#define SHIM_PANEL_NO_RESPONSE -1

static obj_t panel_sheet_panel; // live panel while its sheet is up, else 0
static int panel_sheet_is_save; // which class the live sheet is, for collection
static volatile int panel_sheet_done;
static volatile long long panel_sheet_response = SHIM_PANEL_NO_RESPONSE;

// One NSString, built and consumed on this side. Encoding 4 is
// NSUTF8StringEncoding, and `-initWithBytes:length:encoding:` is what the
// measured URL chain uses: `+stringWithUTF8String:` aborts Bun outright.
static obj_t panel_nsstring(const char *s) {
	if (!s || !s[0]) return 0;
	obj_t allocd = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSString"),
	                                                        sel_registerName("alloc"));
	if (!allocd) return 0;
	return ((obj_t (*)(void *, void *, const char *, unsigned long, long long))objc_msgSend)(
	    allocd, sel_registerName("initWithBytes:length:encoding:"), s,
	    (unsigned long)shim_cstr_len(s), 4LL);
}

// Guard for every selector this section sends. An uncaught ObjC exception
// kills the process with no JS error, so nothing is sent unchecked.
static int panel_has_instance(const char *cls, const char *selname) {
	void *c = objc_getClass(cls);
	if (!c) return 0;
	return class_getInstanceMethod(c, sel_registerName(selname)) != 0;
}

// The shared storage above is taken over by a request that is actually going to
// use it, never on entry: resetting first would clear a live sheet's pointer and
// done flag, which is exactly how a second request used to wipe the first one's
// answer. Every call site below sits next to the send it prepares, after every
// guard that can refuse the request has already answered.
static void panel_reset(void) {
	panel_paths_used = 0;
	panel_paths[0][0] = 0;
	panel_sheet_panel = 0;
	panel_sheet_is_save = 0;
	panel_sheet_done = 0;
	panel_sheet_response = SHIM_PANEL_NO_RESPONSE;
}

// One sheet at a time, which is why a second request is refused instead of
// started: the storage holds one panel, one done flag and one path list, so a
// second sheet would overwrite the first one's state and a page awaiting the first
// pick would read the second panel's answer. A request landing while a sheet is up
// answers SHIM_PANEL_BUSY before anything is touched, leaving the live sheet
// exactly as it was; `dialog.cancel` is the way out of a sheet no longer wanted.
static int panel_sheet_busy(void) { return panel_sheet_panel != 0 && !panel_sheet_done; }

static void panel_copy_path(const char *src) {
	if (!src || panel_paths_used >= SHIM_PANEL_MAX_PATHS) return;
	char *dst = panel_paths[panel_paths_used];
	long i = 0;
	while (src[i] && i < SHIM_PANEL_PATH_BYTES - 1) {
		dst[i] = src[i];
		i++;
	}
	dst[i] = 0;
	panel_paths_used++;
}

// -[NSOpenPanel URLs] -> each -path -> -UTF8String, copied into static storage.
static void panel_collect(obj_t panel) {
	obj_t urls = ((obj_t (*)(void *, void *))objc_msgSend)(panel, sel_registerName("URLs"));
	if (!urls) return;
	unsigned long long n = ((unsigned long long (*)(void *, void *))objc_msgSend)(
	    urls, sel_registerName("count"));
	for (unsigned long long i = 0; i < n; i++) {
		obj_t url = ((obj_t (*)(void *, void *, unsigned long long))objc_msgSend)(
		    urls, sel_registerName("objectAtIndex:"), i);
		if (!url) continue;
		obj_t path = ((obj_t (*)(void *, void *))objc_msgSend)(url, sel_registerName("path"));
		if (!path) continue;
		const char *utf8 = ((const char *(*)(void *, void *))objc_msgSend)(
		    path, sel_registerName("UTF8String"));
		panel_copy_path(utf8);
	}
}

// -[NSSavePanel URL] -> -path -> -UTF8String. A save panel names exactly one
// file and has no -URLs, so this is the whole collection.
static void panel_collect_save(obj_t panel) {
	obj_t url = ((obj_t (*)(void *, void *))objc_msgSend)(panel, sel_registerName("URL"));
	if (!url) return;
	obj_t path = ((obj_t (*)(void *, void *))objc_msgSend)(url, sel_registerName("path"));
	if (!path) return;
	const char *utf8 = ((const char *(*)(void *, void *))objc_msgSend)(
	    path, sel_registerName("UTF8String"));
	panel_copy_path(utf8);
}

// A comma-separated extension list into -setAllowedFileTypes:. A JS array
// cannot cross the boundary, so the list arrives as one C string. A missing
// selector, a null array or a failed string leaves the panel unfiltered rather
// than aborting the pick. The setter is deprecated on macOS 27 but present on
// both panel classes; `allowedContentTypes` would be a UTType object graph.
static void panel_set_file_types(const char *clsname, obj_t panel, const char *types) {
	if (!types || !types[0]) return;
	if (!panel_has_instance(clsname, "setAllowedFileTypes:")) return;
	obj_t cls = objc_getClass("NSMutableArray");
	if (!cls) return;
	obj_t array = ((obj_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("array"));
	if (!array) return;

	const char *cursor = types;
	while (*cursor) {
		char item[64];
		long n = 0;
		while (*cursor && *cursor != ',' && n < (long)sizeof(item) - 1)
			item[n++] = *cursor++;
		item[n] = 0;
		if (*cursor == ',') cursor++;
		const char *ext = item;
		while (*ext == '*' || *ext == '.') ext++;
		if (!*ext) continue;
		obj_t s = panel_nsstring(ext);
		if (s)
			((void (*)(void *, void *, obj_t))objc_msgSend)(
			    array, sel_registerName("addObject:"), s);
	}
	((void (*)(void *, void *, obj_t))objc_msgSend)(
	    panel, sel_registerName("setAllowedFileTypes:"), array);
}

