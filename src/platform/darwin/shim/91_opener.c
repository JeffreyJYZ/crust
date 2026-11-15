// --- opener: the first half of the opener/system-information unit ------------
// Compiled by platform/darwin/opener.ts together with 96_os_info.c, and deliberately absent from
// SHIM_PARTS: NSWorkspace needs no window, and nothing here belongs in the window shim's unit.
// The shim's four rules hold — one fixed prototype per objc_msgSend, no framework header, no object
// and no struct across bun:ffi, and every string built from bytes on this side, because a short
// ASCII NSString is a tagged pointer that cannot cross the boundary.

typedef void *op_t;

extern op_t objc_msgSend(void *self, void *sel, ...);
extern op_t objc_getClass(const char *name);
extern op_t sel_registerName(const char *name);
extern op_t __CFStringMakeConstantString(const char *cstr);
extern int CFStringGetCString(void *s, char *buf, long size, unsigned int encoding);

#define OP_UTF8 0x08000100 /* kCFStringEncodingUTF8 */

// NSString from a byte range. Encoding 4 is NSUTF8StringEncoding; a JS string cannot cross, so
// every path and URL arrives as bytes and never as an object.
static op_t op_nsstring(const char *bytes, long len) {
	op_t allocd = ((op_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSString"),
	                                                      sel_registerName("alloc"));
	if (!allocd) return 0;
	return ((op_t (*)(void *, void *, const char *, unsigned long, long long))objc_msgSend)(
	    allocd, sel_registerName("initWithBytes:length:encoding:"), bytes, (unsigned long)len, 4LL);
}

// The last answer, for a caller that wants a reason. Static storage: valid until the next call.
static char op_reason[256];

static void op_reason_set(const char *text) {
	long i = 0;
	while (text[i] && i < 255) {
		op_reason[i] = text[i];
		i++;
	}
	op_reason[i] = 0;
}

const char *crust_opener_reason(void) { return op_reason; }

// +[NSWorkspace sharedWorkspace] — nil on a system with no AppKit, which every entry point
// checks before sending anything.
static op_t op_workspace(void) {
	op_t cls = objc_getClass("NSWorkspace");
	if (!cls) return 0;
	return ((op_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("sharedWorkspace"));
}

// +[NSURL fileURLWithPath:] — the URL never leaves C, and the path stays the caller's bytes.
static op_t op_file_url(const char *bytes, long len) {
	op_t path = op_nsstring(bytes, len);
	if (!path) return 0;
	op_t cls = objc_getClass("NSURL");
	if (!cls) return 0;
	return ((op_t (*)(void *, void *, op_t))objc_msgSend)(cls, sel_registerName("fileURLWithPath:"),
	                                                     path);
}

// -[NSWorkspace openURL:] answers a BOOL, read as char because it arrives in w0 as one byte.
static int op_open_url(op_t workspace, op_t url) {
	return (int)(char)((char (*)(void *, void *, op_t))objc_msgSend)(
	    workspace, sel_registerName("openURL:"), url);
}

// 1 when the OS took it, 0 when it refused; the reason names which step failed.
int crust_opener_open_path(const char *bytes, long len) {
	op_t workspace = op_workspace();
	if (!workspace) {
		op_reason_set("NSWorkspace is not reachable");
		return 0;
	}
	op_t url = op_file_url(bytes, len);
	if (!url) {
		op_reason_set("the path did not become a file URL");
		return 0;
	}
	if (!op_open_url(workspace, url)) {
		op_reason_set("NSWorkspace -openURL: answered NO");
		return 0;
	}
	op_reason_set("opened");
	return 1;
}

// +[NSURL URLWithString:] rather than fileURLWithPath:, so a scheme survives: https, mailto,
// x-apple.systempreferences.
int crust_opener_open_url(const char *bytes, long len) {
	op_t workspace = op_workspace();
	if (!workspace) {
		op_reason_set("NSWorkspace is not reachable");
		return 0;
	}
	op_t text = op_nsstring(bytes, len);
	if (!text) {
		op_reason_set("the URL text did not become a string");
		return 0;
	}
	op_t cls = objc_getClass("NSURL");
	if (!cls) {
		op_reason_set("NSURL is not reachable");
		return 0;
	}
	op_t url = ((op_t (*)(void *, void *, op_t))objc_msgSend)(cls, sel_registerName("URLWithString:"),
	                                                         text);
	if (!url) {
		op_reason_set("NSURL -URLWithString: answered nil");
		return 0;
	}
	if (!op_open_url(workspace, url)) {
		op_reason_set("NSWorkspace -openURL: answered NO");
		return 0;
	}
	op_reason_set("opened");
	return 1;
}

// -[NSWorkspace activateFileViewerSelectingURLs:] takes an array and answers nothing, so the only
// evidence is that the send returned; Finder owns everything after that.
int crust_opener_reveal(const char *bytes, long len) {
	op_t workspace = op_workspace();
	if (!workspace) {
		op_reason_set("NSWorkspace is not reachable");
		return 0;
	}
	op_t url = op_file_url(bytes, len);
	if (!url) {
		op_reason_set("the path did not become a file URL");
		return 0;
	}
	op_t cls = objc_getClass("NSArray");
	if (!cls) {
		op_reason_set("NSArray is not reachable");
		return 0;
	}
	op_t array = ((op_t (*)(void *, void *, op_t))objc_msgSend)(cls,
	                                                           sel_registerName("arrayWithObject:"),
	                                                           url);
	if (!array) {
		op_reason_set("the URL did not become an array");
		return 0;
	}
	((void (*)(void *, void *, op_t))objc_msgSend)(
	    workspace, sel_registerName("activateFileViewerSelectingURLs:"), array);
	op_reason_set("revealed");
	return 1;
}
