// --- find in page: WKWebView's public find API, driven from C --------------
// `-findString:withConfiguration:completionHandler:` is the only public entry point, and
// it takes a block. A block may not cross bun:ffi, so this unit builds GLOBAL blocks the
// way `70_sheet_block.c` does: plain memory { isa, flags, reserved, invoke, descriptor },
// isa from objc_getClass("__NSGlobalBlock__"), bit 28 set and bit 30 (BLOCK_HAS_SIGNATURE)
// deliberately clear, because setting it without a real signature makes the runtime read
// past the struct. 109_find_ids.c holds one block per in-flight request id, so an older
// completion cannot answer a newer search, exactly as in the snapshot unit.
// The answer is one BOOL: WKFindResult carries -matchFound and no count, so a count needs
// a private selector and is reported as 0 or 1 rather than invented.
// `-_clearFindIndicator` is private and is never sent from here; the plugin answers
// not-implemented naming it instead.

typedef void *find_t;

extern find_t objc_msgSend(void *self, void *sel, ...);
extern find_t objc_getClass(const char *name);
extern find_t sel_registerName(const char *name);

#define FIND_BLOCK_IS_GLOBAL (1 << 28)

/** The JSCallback bun:ffi hands out: the request id and one int, because one BOOL is the answer. */
static int (*find_sink)(int id, int found) = 0;

static void find_finish(int id, void *result);
/** The block a request id owns, chosen in 109_find_ids.c before the send. */
static void *find_block_for(int id);

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
	find_t text = ((find_t (*)(void *, void *, const char *, unsigned long, long long))objc_msgSend)(
	    allocd, sel_registerName("initWithBytes:length:encoding:"), bytes, (unsigned long)length,
	    4LL);
	crust_own(text);
	return text;
}

// Ownership follows 00_audit.c: crust_own when the +1 is built, crust_release after the WebKit
// send that copies it, so the audit sees both sides and the net stays zero.

// Runs on the main thread when WebKit has searched. `-matchFound` is a BOOL, read as one
// byte because it arrives in w0 that way. The id names the request, so a completion from a
// superseded search is discarded by the caller instead of answering the newer one.
static void find_finish(int id, void *result) {
	int found = 0;
	if (result && find_has(result, "matchFound"))
		found = (int)(char)((char (*)(void *, void *))objc_msgSend)(
		    result, sel_registerName("matchFound"));
	if (find_sink) find_sink(id, found);
}

void crust_find_set_sink(void *sink) { find_sink = (int (*)(int, int))sink; }

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
	crust_own(config);
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
// build, 3 the completion block could not be built. `id` is the generation the completion
// reports back so a stale result cannot settle a newer search.
int crust_find_search(void *web, const char *bytes, long long length, int backwards,
                      int case_sensitive, int id) {
	void *block;
	find_t text;
	find_t config;
	if (!crust_find_available(web)) return 1;
	block = find_block_for(id);
	if (!block) return 3;
	text = find_nsstring(bytes, length);
	if (!text) return 2;
	config = find_config(backwards, case_sensitive);
	if (!config) {
		crust_release(text);
		return 2;
	}
	((void (*)(void *, void *, find_t, find_t, void *))objc_msgSend)(
	    web, sel_registerName("findString:withConfiguration:completionHandler:"), text, config,
	    block);
	// WebKit copies what it needs. Both +1 objects we built end with this send.
	crust_release(config);
	crust_release(text);
	return 0;
}

// There is no process-wide "last query" any more: a repeat is a search with the text the JS
// adapter kept for that webview, so two windows cannot overwrite each other's query. The symbol
// stays so an older binding fails by name rather than reaching a stale string.
int crust_find_repeat(void *web, int backwards, int case_sensitive) {
	(void)web; (void)backwards; (void)case_sensitive;
	return 1;
}
