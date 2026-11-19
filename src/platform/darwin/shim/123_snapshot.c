// --- snapshot: the page as the webview rendered it -------------------------
// `-[WKWebView takeSnapshotWithConfiguration:completionHandler:]` takes a block, and a block
// cannot cross bun:ffi, so this unit builds a GLOBAL block the way 108_find.c and
// 70_sheet_block.c do: plain memory { isa, flags, reserved, invoke, descriptor }, isa from
// objc_getClass("__NSGlobalBlock__"), bit 28 set and bit 30 (BLOCK_HAS_SIGNATURE) deliberately
// clear, because setting it without a real signature makes the runtime read past the struct.
//
// The picture never leaves C either. The handler encodes it to PNG at once, keeps that NSData,
// and reports the byte length, so the caller can ask again with an exact-size buffer exactly as
// 101_clipboard_image.c does for a pasteboard NSImage. Nothing here reads the display: this is
// WebKit's own render, so no Screen Recording grant is involved and CGWindowListCreateImage is
// never called. The reads are a second part, joined into the same unit by snapshot-unit.ts.

typedef void *shot_t;

extern shot_t objc_msgSend(void *self, void *sel, ...);
extern shot_t objc_getClass(const char *name);
extern shot_t sel_registerName(const char *name);
extern shot_t __CFStringMakeConstantString(const char *cstr);

#define SHOT_BLOCK_IS_GLOBAL (1 << 28)

/** NSBitmapImageFileTypePNG. No header is reachable from TinyCC, and it has been 4 since it existed. */
enum { SHOT_PNG_TYPE = 4 };

/** `crust_shot_take`'s answers; only `started` means a picture is on its way. */
enum { SHOT_STARTED = 0, SHOT_UNAVAILABLE = 1, SHOT_NO_CONFIG = 2, SHOT_NO_BLOCK = 3 };

typedef struct {
	unsigned long reserved;
	unsigned long size;
} shot_block_descriptor;

// (^)(NSImage *image, NSError *error) — the block itself is the hidden first argument.
typedef struct {
	void *isa;
	int flags;
	int reserved;
	void (*invoke)(void *, void *, void *);
	void *descriptor;
} shot_block_t;

static shot_block_descriptor shot_desc;
static shot_block_t shot_block;
static int shot_block_ready;

/** The JSCallback bun:ffi hands out: 1 for a picture, 0 for a refusal. */
static int (*shot_sink)(int ok) = 0;

/** The last picture: a retained PNG NSData, its pixel size, and the scale measured from it. */
static shot_t shot_png = 0;
static long long shot_px_w = 0;
static long long shot_px_h = 0;
static double shot_scale = 1.0;
/** The webview's width in points when the snapshot was asked for, so scale is measured, not assumed. */
static double shot_frame_w = 0;

static int shot_has(shot_t obj, const char *name) {
	if (!obj) return 0;
	return (int)(char)((char (*)(void *, void *, void *))objc_msgSend)(
	    obj, sel_registerName("respondsToSelector:"), sel_registerName(name));
}

static long long shot_integer(shot_t obj, const char *name) {
	if (!obj) return 0;
	return ((long long (*)(void *, void *))objc_msgSend)(obj, sel_registerName(name));
}

// Drop the previous picture and its numbers, so a failed snapshot can never leave stale bytes
// behind for a caller that reads after it.
static void shot_clear(void) {
	if (shot_png) {
		((void (*)(void *, void *))objc_msgSend)(shot_png, sel_registerName("release"));
		shot_png = 0;
	}
	shot_px_w = 0;
	shot_px_h = 0;
	shot_scale = 1.0;
}

// The webview's width in points, through `valueForKey:` so no struct crosses bun:ffi: NSView
// boxes its frame in an NSValue, the same read shim_frame_num uses. 0 when it cannot be read, and
// then the scale stays 1 rather than being invented from a missing frame.
static double shot_width_points(shot_t view) {
	shot_t key = __CFStringMakeConstantString("frame");
	shot_t box;
	double rect[4] = {0, 0, 0, 0};
	if (!key) return 0;
	box = ((shot_t (*)(void *, void *, shot_t))objc_msgSend)(
	    view, sel_registerName("valueForKey:"), key);
	if (!box) return 0;
	((void (*)(void *, void *, void *))objc_msgSend)(box, sel_registerName("getValue:"), rect);
	return rect[2];
}

// PNG bytes of one snapshot image, retained. Pixels come from the bitmap rep itself, so what the
// caller reports as width and height is what the picture holds, never what the window should be.
static shot_t shot_encode(shot_t image, long long *w, long long *h) {
	shot_t tiff;
	shot_t rep_class;
	shot_t rep;
	shot_t png;
	if (!shot_has(image, "TIFFRepresentation")) return 0;
	tiff = ((shot_t (*)(void *, void *))objc_msgSend)(image, sel_registerName("TIFFRepresentation"));
	if (!tiff) return 0;
	rep_class = objc_getClass("NSBitmapImageRep");
	if (!shot_has(rep_class, "imageRepWithData:")) return 0;
	rep = ((shot_t (*)(void *, void *, shot_t))objc_msgSend)(
	    rep_class, sel_registerName("imageRepWithData:"), tiff);
	if (!shot_has(rep, "representationUsingType:properties:")) return 0;
	*w = shot_integer(rep, "pixelsWide");
	*h = shot_integer(rep, "pixelsHigh");
	if (*w <= 0 || *h <= 0) return 0;
	// A nil properties dictionary is documented as acceptable.
	png = ((shot_t (*)(void *, void *, long long, shot_t))objc_msgSend)(
	    rep, sel_registerName("representationUsingType:properties:"), (long long)SHOT_PNG_TYPE,
	    (shot_t)0);
	if (!png) return 0;
	return ((shot_t (*)(void *, void *))objc_msgSend)(png, sel_registerName("retain"));
}

static void shot_invoke(void *block, void *image, void *error);

static int shot_block_init(void) {
	if (shot_block_ready) return 1;
	shot_t isa = objc_getClass("__NSGlobalBlock__");
	if (!isa) return 0;
	shot_desc.reserved = 0;
	shot_desc.size = sizeof(shot_block_t);
	shot_block.isa = isa;
	shot_block.flags = SHOT_BLOCK_IS_GLOBAL;
	shot_block.reserved = 0;
	shot_block.invoke = shot_invoke;
	shot_block.descriptor = &shot_desc;
	shot_block_ready = 1;
	return 1;
}

// Runs on the main thread once WebKit has rendered. The encode happens here, before the caller is
// told, so a caller that wakes reads one complete picture rather than a half-written one.
static void shot_invoke(void *block, void *image, void *error) {
	long long w = 0;
	long long h = 0;
	shot_t png;
	int ok = 0;
	(void)block;
	shot_clear();
	if (image && !error) {
		png = shot_encode(image, &w, &h);
		if (png) {
			shot_png = png;
			shot_px_w = w;
			shot_px_h = h;
			shot_scale = shot_frame_w > 0 ? (double)w / shot_frame_w : 1.0;
			ok = 1;
		}
	}
	if (shot_sink) shot_sink(ok);
}

void crust_shot_set_sink(void *sink) { shot_sink = (int (*)(int))sink; }

// 1 when the webview can render a picture at all: the configuration class, the global block class
// and the selector, so a system without them is refused by name instead of sending into nil.
int crust_shot_available(void *web) {
	if (!web) return 0;
	if (!objc_getClass("WKSnapshotConfiguration")) return 0;
	if (!objc_getClass("__NSGlobalBlock__")) return 0;
	return shot_has(web, "takeSnapshotWithConfiguration:completionHandler:");
}

// 0 started, 1 no webview or no snapshot selector, 2 the configuration did not build, 3 the
// completion block could not be built. The configuration is a default one: no `snapshotWidth`, so
// WebKit renders the view's own bounds, and a default rect, which is the whole view.
int crust_shot_take(void *web) {
	shot_t config;
	if (!crust_shot_available(web)) return SHOT_UNAVAILABLE;
	if (!shot_block_init()) return SHOT_NO_BLOCK;
	config = ((shot_t (*)(void *, void *))objc_msgSend)(
	    objc_getClass("WKSnapshotConfiguration"), sel_registerName("new"));
	if (!config) return SHOT_NO_CONFIG;
	shot_clear();
	shot_frame_w = shot_width_points(web);
	((void (*)(void *, void *, shot_t, void *))objc_msgSend)(
	    web, sel_registerName("takeSnapshotWithConfiguration:completionHandler:"), config,
	    (void *)&shot_block);
	((void (*)(void *, void *))objc_msgSend)(config, sel_registerName("release"));
	return SHOT_STARTED;
}
