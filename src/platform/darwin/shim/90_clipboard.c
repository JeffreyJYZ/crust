// --- clipboard -------------------------------------------------------------
// NSPasteboard only, and text stays in C both ways: -stringForType: hands back an
// autoreleased NSString, so a read copies its bytes into the caller's buffer and
// reports the full length; a write builds its NSString here, because a short ASCII
// NSString is a tagged pointer and nothing of that shape may cross bun:ffi.
// The three externs are repeated rather than taken from 10_prelude.c so this part
// compiles alone as well as inside the one shim unit.

extern void *objc_msgSend(void *self, void *sel, ...);
extern void *objc_getClass(const char *name);
extern void *sel_registerName(const char *name);

// An AppKit data symbol, not a call: both directions take the same one, so a
// mistyped "public.utf8-plain-text" literal cannot drift from what AppKit expects.
extern void *NSPasteboardTypeString;

// [obj respondsToSelector:sel] — the only existence test that is safe on an
// instance. Nothing here is sent on trust: an uncaught ObjC exception kills the
// process with no JavaScript error.
static int clip_has(void *obj, const char *selname) {
	if (!obj) return 0;
	return (int)(char)((char (*)(void *, void *, void *))objc_msgSend)(
	    obj, sel_registerName("respondsToSelector:"), sel_registerName(selname));
}

// One NSString from bytes, consumed here. `+stringWithUTF8String:` aborts Bun, so
// `-initWithBytes:length:encoding:` (4 = UTF8) with an explicit length is the only
// constructor used. Length 0 is the empty string a clear writes.
static void *clip_nsstring(const char *bytes, long long length) {
	if (!bytes || length < 0) return 0;
	void *allocd = ((void *(*)(void *, void *))objc_msgSend)(objc_getClass("NSString"),
	                                                        sel_registerName("alloc"));
	if (!allocd) return 0;
	return ((void *(*)(void *, void *, const char *, unsigned long, long long))objc_msgSend)(
	    allocd, sel_registerName("initWithBytes:length:encoding:"), bytes, (unsigned long)length,
	    4LL);
}

// The general pasteboard, or 0 when AppKit is not linked or the class method is
// gone. Guarded, because an uncaught ObjC exception terminates the process.
static void *clip_general(void) {
	void *cls = objc_getClass("NSPasteboard");
	if (!clip_has(cls, "generalPasteboard")) return 0;
	return ((void *(*)(void *, void *))objc_msgSend)(cls, sel_registerName("generalPasteboard"));
}

// 1 when every selector this part sends is present. A test asserts this without
// touching the pasteboard, so "the unit compiled" and "AppKit can serve it" stay
// separate answers.
int shim_clipboard_available(void) {
	void *board = clip_general();
	if (!board) return 0;
	int can_read = clip_has(board, "stringForType:");
	int can_write = clip_has(board, "clearContents") && clip_has(board, "setString:forType:");
	return can_read && can_write ? 1 : 0;
}

// UTF-8 text into `dst`, and the full byte length so a caller whose buffer was too
// small can ask again with an exact one. 0 is "the pasteboard holds no text" — the
// empty answer — and -1 is "no pasteboard or no selector", which is a failure.
long long shim_clipboard_read(char *dst, long long cap) {
	void *board = clip_general();
	if (!board || !dst || cap <= 0) return -1;
	if (!clip_has(board, "stringForType:")) return -1;
	void *text = ((void *(*)(void *, void *, void *))objc_msgSend)(
	    board, sel_registerName("stringForType:"), NSPasteboardTypeString);
	if (!clip_has(text, "UTF8String")) return 0;
	const char *bytes =
	    ((const char *(*)(void *, void *))objc_msgSend)(text, sel_registerName("UTF8String"));
	if (!bytes) return 0;
	long long length = 0;
	while (bytes[length]) length++;
	long long copied = length < cap - 1 ? length : cap - 1;
	for (long long i = 0; i < copied; i++) dst[i] = bytes[i];
	dst[copied] = 0;
	return length;
}

// 1 written, 0 the pasteboard refused it, -1 a selector or the framework is
// missing. Never a throw: an ObjC exception here would kill the process, so every
// send is guarded and the answer is a status.
int shim_clipboard_write(const char *bytes, long long length) {
	void *board = clip_general();
	if (!board || !bytes || length < 0) return -1;
	if (!clip_has(board, "clearContents") || !clip_has(board, "setString:forType:")) return -1;
	void *text = clip_nsstring(bytes, length);
	if (!text) return 0;
	((long long (*)(void *, void *))objc_msgSend)(board, sel_registerName("clearContents"));
	return (int)(char)((char (*)(void *, void *, void *, void *))objc_msgSend)(
	    board, sel_registerName("setString:forType:"), text, NSPasteboardTypeString);
}
