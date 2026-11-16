// --- find in page: WKWebView's public find API, driven from C --------------
// `-findString:withConfiguration:completionHandler:` is the only public entry point, and
// it takes a block. A block may not cross bun:ffi, so this unit builds a GLOBAL block the
// way `70_sheet_block.c` does: plain memory { isa, flags, reserved, invoke, descriptor },
// isa from objc_getClass("__NSGlobalBlock__"), bit 28 set and bit 30 (BLOCK_HAS_SIGNATURE)
// deliberately clear, because setting it without a real signature makes the runtime read
// past the struct. A global block needs no copy or dispose helper, so `Block_copy` is a
// documented no-op and WebKit may hold it as long as it likes.
// The answer is one BOOL: WKFindResult carries -matchFound and no count, so a count needs
// a private selector and is reported as 0 or 1 rather than invented.
// `-_clearFindIndicator` is private and is never sent from here; the plugin answers
// not-implemented naming it instead.

typedef void *find_t;

extern find_t objc_msgSend(void *self, void *sel, ...);
extern find_t objc_getClass(const char *name);
extern find_t sel_registerName(const char *name);

#define FIND_BLOCK_IS_GLOBAL (1 << 28)

typedef struct {
	unsigned long reserved;
	unsigned long size;
} find_block_descriptor;

// (^)(WKFindResult *result) — the block itself is the hidden first argument.
typedef struct {
	void *isa;
	int flags;
	int reserved;
	void (*invoke)(void *, void *);
	void *descriptor;
} find_block_t;

static find_block_descriptor find_desc;
static find_block_t find_block;
static int find_block_ready;

// The JSCallback bun:ffi hands out: one int, because one BOOL is the whole answer.
static int (*find_sink)(int found) = 0;

// The string the last search used, retained so -next and -previous can repeat it without
// the caller keeping a copy of its own.
static find_t find_last = 0;

static void find_invoke(void *block, void *result);

static int find_has(void *obj, const char *name) {
	if (!obj) return 0;
	return (int)(char)((char (*)(void *, void *, void *))objc_msgSend)(
	    obj, sel_registerName("respondsToSelector:"), sel_registerName(name));
}

// NSString from a byte range: encoding 4 is NSUTF8StringEncoding, and a JS string cannot
// cross, so every search text arrives as bytes.
static find_t find_nsstring(const char *bytes, long long length) {
	if (!bytes || length < 0) return 0;
	find_t allocd = ((find_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSString"),
	                                                          sel_registerName("alloc"));
	if (!allocd) return 0;
	return ((find_t (*)(void *, void *, const char *, unsigned long, long long))objc_msgSend)(
	    allocd, sel_registerName("initWithBytes:length:encoding:"), bytes, (unsigned long)length,
	    4LL);
}

static int find_block_init(void) {
	if (find_block_ready) return 1;
	find_t isa = objc_getClass("__NSGlobalBlock__");
	if (!isa) return 0;
	find_desc.reserved = 0;
	find_desc.size = sizeof(find_block_t);
	find_block.isa = isa;
	find_block.flags = FIND_BLOCK_IS_GLOBAL;
	find_block.reserved = 0;
	find_block.invoke = find_invoke;
	find_block.descriptor = &find_desc;
	find_block_ready = 1;
	return 1;
}

// Runs on the main thread when WebKit has searched. `-matchFound` is a BOOL, read as one
// byte because it arrives in w0 that way.
static void find_invoke(void *block, void *result) {
	(void)block;
	int found = 0;
	if (result && find_has(result, "matchFound"))
		found = (int)(char)((char (*)(void *, void *))objc_msgSend)(
		    result, sel_registerName("matchFound"));
	if (find_sink) find_sink(found);
}

void crust_find_set_sink(void *sink) { find_sink = (int (*)(int))sink; }

// A WKFindConfiguration with the two flags the search takes. `-new` is NSObject's, so the
// object is ours to configure and WebKit copies it as it needs.
static find_t find_config(int backwards, int case_sensitive) {
	find_t cls = objc_getClass("WKFindConfiguration");
	if (!cls) return 0;
	find_t config = ((find_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("new"));
	if (!config) return 0;
	((void (*)(void *, void *, int))objc_msgSend)(config, sel_registerName("setBackwards:"),
	                                              backwards ? 1 : 0);
	((void (*)(void *, void *, int))objc_msgSend)(config, sel_registerName("setCaseSensitive:"),
	                                              case_sensitive ? 1 : 0);
	return config;
}

// 1 when the webview can find at all: WKFindConfiguration and the find selector both
// exist, so a system without them is refused by name instead of sending into nil.
int crust_find_available(void *web) {
	if (!web) return 0;
	if (!objc_getClass("WKFindConfiguration")) return 0;
	if (!objc_getClass("__NSGlobalBlock__")) return 0;
	return find_has(web, "findString:withConfiguration:completionHandler:");
}

// 0 started, 1 no webview or no find selector, 2 the string or the configuration did not
// build, 3 the completion block could not be built.
int crust_find_search(void *web, const char *bytes, long long length, int backwards,
                      int case_sensitive) {
	if (!crust_find_available(web)) return 1;
	if (!find_block_init()) return 3;
	find_t text = find_nsstring(bytes, length);
	if (!text) return 2;
	find_t config = find_config(backwards, case_sensitive);
	if (!config) return 2;
	// Retain before the send: WebKit copies the string, and -next repeats this one after
	// the caller's buffer is long gone.
	find_t kept = ((find_t (*)(void *, void *))objc_msgSend)(text, sel_registerName("retain"));
	if (kept) {
		if (find_last) ((void (*)(void *, void *))objc_msgSend)(find_last,
		                                                       sel_registerName("release"));
		find_last = kept;
	}
	((void (*)(void *, void *, find_t, find_t, void *))objc_msgSend)(
	    web, sel_registerName("findString:withConfiguration:completionHandler:"), text, config,
	    (void *)&find_block);
	return 0;
}

// 0 started, 1 no search has run yet or no find selector, 2 the configuration did not
// build, 3 the completion block could not be built. `backwards` is how next and previous
// differ: WKFindConfiguration has no findNext/findPrevious, so advancing repeats the last
// search with the direction flipped, and the case flag is the caller's to carry.
int crust_find_repeat(void *web, int backwards, int case_sensitive) {
	if (!web || !find_last) return 1;
	if (!find_has(web, "findString:withConfiguration:completionHandler:")) return 1;
	if (!find_block_init()) return 3;
	find_t config = find_config(backwards, case_sensitive);
	if (!config) return 2;
	((void (*)(void *, void *, find_t, find_t, void *))objc_msgSend)(
	    web, sel_registerName("findString:withConfiguration:completionHandler:"), find_last, config,
	    (void *)&find_block);
	return 0;
}

// 1 when the global completion block is built and WebKit's block class is reachable, which is
// the half a suite can prove with no window and no search: a block that failed to build would
// otherwise only show as a completion handler that never fires.
int crust_find_block_ready(void) { return find_block_init(); }
