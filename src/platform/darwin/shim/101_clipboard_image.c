// --- clipboard image ------------------------------------------------------
// NSImage -> NSBitmapImageRep -> PNG bytes, all of it in C: that object graph is
// the thing that cannot cross bun:ffi, so a read copies out only the finished
// bytes and reports the full length for a second, exact-size pass. Statics are
// prefixed img_ because this part is joined with 90_clipboard.c in one unit.
// Every send is guarded: an uncaught ObjC exception kills the process outright.

extern void *objc_msgSend(void *self, void *sel, ...);
extern void *objc_getClass(const char *name);
extern void *sel_registerName(const char *name);
extern void *class_getInstanceMethod(void *cls, void *sel);

// An AppKit data symbol, not a call, the same way NSPasteboardTypeString is.
extern void *NSPasteboardTypePNG;

// NSBitmapImageFileTypePNG. No header is reachable from TinyCC, so the enum's
// value is spelled out; it has been 4 since the type was introduced.
enum { IMG_PNG_TYPE = 4 };

static int img_has(void *obj, const char *selname) {
	if (!obj) return 0;
	return (int)(char)((char (*)(void *, void *, void *))objc_msgSend)(
	    obj, sel_registerName("respondsToSelector:"), sel_registerName(selname));
}

// respondsToSelector: on a class object only sees class methods, so an instance
// method is probed through the runtime instead.
static int img_has_instance(void *cls, const char *selname) {
	if (!cls) return 0;
	return class_getInstanceMethod(cls, sel_registerName(selname)) != 0;
}

static void *img_general(void) {
	void *cls = objc_getClass("NSPasteboard");
	if (!img_has(cls, "generalPasteboard")) return 0;
	return ((void *(*)(void *, void *))objc_msgSend)(cls, sel_registerName("generalPasteboard"));
}

// [NSArray arrayWithObject:cls] — the classes list -readObjectsForClasses: wants.
static void *img_class_array(const char *name) {
	void *cls = objc_getClass(name);
	void *array = objc_getClass("NSArray");
	if (!cls || !img_has(array, "arrayWithObject:")) return 0;
	return ((void *(*)(void *, void *, void *))objc_msgSend)(
	    array, sel_registerName("arrayWithObject:"), cls);
}

// The first NSImage on the pasteboard, or 0 when it holds none.
static void *img_first(void *board) {
	if (!img_has(board, "readObjectsForClasses:options:")) return 0;
	void *classes = img_class_array("NSImage");
	if (!classes) return 0;
	void *found = ((void *(*)(void *, void *, void *, void *))objc_msgSend)(
	    board, sel_registerName("readObjectsForClasses:options:"), classes, (void *)0);
	if (!img_has(found, "count")) return 0;
	long long count =
	    ((long long (*)(void *, void *))objc_msgSend)(found, sel_registerName("count"));
	if (count <= 0) return 0;
	return ((void *(*)(void *, void *, long long))objc_msgSend)(
	    found, sel_registerName("objectAtIndex:"), 0LL);
}

// The PNG bytes of one NSImage, or 0 when it cannot be encoded.
static void *img_png(void *image) {
	if (!img_has(image, "TIFFRepresentation")) return 0;
	void *tiff =
	    ((void *(*)(void *, void *))objc_msgSend)(image, sel_registerName("TIFFRepresentation"));
	if (!tiff) return 0;
	void *rep_class = objc_getClass("NSBitmapImageRep");
	if (!img_has(rep_class, "imageRepWithData:")) return 0;
	void *rep = ((void *(*)(void *, void *, void *))objc_msgSend)(
	    rep_class, sel_registerName("imageRepWithData:"), tiff);
	if (!img_has(rep, "representationUsingType:properties:")) return 0;
	// A nil properties dictionary is documented as acceptable.
	return ((void *(*)(void *, void *, long long, void *))objc_msgSend)(
	    rep, sel_registerName("representationUsingType:properties:"), (long long)IMG_PNG_TYPE,
	    (void *)0);
}

// 1 when every selector this part sends is present, so "the unit compiled" and
// "AppKit can serve the image half" stay separate answers.
int shim_clipboard_image_available(void) {
	void *board = img_general();
	if (!board) return 0;
	int can_read = img_has(board, "readObjectsForClasses:options:");
	int can_write = img_has(board, "clearContents") && img_has(board, "setData:forType:");
	void *rep = objc_getClass("NSBitmapImageRep");
	int can_encode = img_has(rep, "imageRepWithData:") &&
	                 img_has_instance(rep, "representationUsingType:properties:");
	int can_data = img_has(objc_getClass("NSData"), "dataWithBytes:length:");
	return can_read && can_write && can_encode && can_data ? 1 : 0;
}

// PNG bytes into `dst`, and the full length so a caller whose buffer was too
// small can ask again with an exact one. 0 is "the pasteboard holds no image",
// which is the empty answer, and -1 is a missing pasteboard, selector or encoder.
long long shim_clipboard_image_read(char *dst, long long cap) {
	void *board = img_general();
	if (!board || cap < 0) return -1;
	void *image = img_first(board);
	if (!image) return img_has(board, "readObjectsForClasses:options:") ? 0 : -1;
	void *png = img_png(image);
	if (!png || !img_has(png, "length")) return -1;
	long long length =
	    ((long long (*)(void *, void *))objc_msgSend)(png, sel_registerName("length"));
	if (length <= 0) return -1;
	if (!dst || cap <= 0) return length;
	const char *bytes =
	    ((const char *(*)(void *, void *))objc_msgSend)(png, sel_registerName("bytes"));
	if (!bytes) return -1;
	long long copied = length < cap ? length : cap;
	for (long long i = 0; i < copied; i++) dst[i] = bytes[i];
	return length;
}

// 1 written, 0 the pasteboard refused it, -1 a selector or the framework is
// missing. The bytes are wrapped in an NSData here, never handed out as one.
int shim_clipboard_image_write(const char *bytes, long long length) {
	void *board = img_general();
	if (!board || !bytes || length <= 0) return -1;
	if (!img_has(board, "clearContents") || !img_has(board, "setData:forType:")) return -1;
	void *data_class = objc_getClass("NSData");
	if (!img_has(data_class, "dataWithBytes:length:")) return -1;
	void *data = ((void *(*)(void *, void *, const char *, unsigned long))objc_msgSend)(
	    data_class, sel_registerName("dataWithBytes:length:"), bytes, (unsigned long)length);
	if (!data) return 0;
	((long long (*)(void *, void *))objc_msgSend)(board, sel_registerName("clearContents"));
	return (int)(char)((char (*)(void *, void *, void *, void *))objc_msgSend)(
	    board, sel_registerName("setData:forType:"), data, NSPasteboardTypePNG);
}
