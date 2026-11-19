// --- crust testing: run a script in a page and hand its answer back ---------
// `-evaluateJavaScript:completionHandler:` takes a block, which may not cross bun:ffi, so this unit
// builds a GLOBAL block the way `108_find.c` and `70_sheet_block.c` do: plain memory
// { isa, flags, reserved, invoke, descriptor }, isa from objc_getClass("__NSGlobalBlock__"), bit 28
// set and bit 30 (BLOCK_HAS_SIGNATURE) deliberately clear, because setting it without a real
// signature makes the runtime read past the struct. A global block needs no copy or dispose helper.
//
// The answer is a string: the page's own snippets return JSON, and JSON is the one shape that
// survives the boundary without an object graph. An NSError is reported as kind 1 with the
// localised message, and a nil result as kind 2, so the caller can tell "the page threw", "the page
// answered nothing" and "the page answered" apart without inspecting a pointer.

typedef void *te_t;

extern te_t objc_msgSend(void *self, void *sel, ...);
extern te_t objc_getClass(const char *name);
extern te_t sel_registerName(const char *name);

#define TE_BLOCK_IS_GLOBAL (1 << 28)

typedef struct {
	unsigned long reserved;
	unsigned long size;
} te_block_descriptor;

// (^)(id result, NSError *error) — the block itself is the hidden first argument.
typedef struct {
	void *isa;
	int flags;
	int reserved;
	void (*invoke)(void *, void *, void *);
	void *descriptor;
} te_block_t;

static te_block_descriptor te_desc;
static te_block_t te_block;
static int te_block_ready;

// The JSCallback bun:ffi hands out: kind, bytes, length.
static void (*te_sink)(int kind, const char *bytes, long long length) = 0;

// Defined below; declared here because the block records its address before the body reads it.
static void te_invoke(void *block, void *result, void *error);

static int te_has(void *obj, const char *name) {
	if (!obj) return 0;
	return (int)(char)((char (*)(void *, void *, void *))objc_msgSend)(
	    obj, sel_registerName("respondsToSelector:"), sel_registerName(name));
}

// NSString from a byte range: encoding 4 is NSUTF8StringEncoding, and a JS string cannot cross, so
// every script arrives as bytes.
static te_t te_nsstring(const char *bytes, long long length) {
	if (!bytes || length < 0) return 0;
	te_t allocated = ((te_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSString"),
	                                                          sel_registerName("alloc"));
	if (!allocated) return 0;
	return ((te_t (*)(void *, void *, const char *, unsigned long, long long))objc_msgSend)(
	    allocated, sel_registerName("initWithBytes:length:encoding:"), bytes, (unsigned long)length,
	    4LL);
}

static long long te_utf8_len(const char *bytes) {
	long long length = 0;
	if (!bytes) return 0;
	while (bytes[length]) length++;
	return length;
}

// Hand one string to the sink, when the object really is a string.
static void te_emit(int kind, te_t object) {
	const char *bytes;
	if (!object || !te_has(object, "UTF8String")) {
		if (te_sink) te_sink(2, "", 0);
		return;
	}
	bytes = ((const char *(*)(void *, void *))objc_msgSend)(object,
	                                                        sel_registerName("UTF8String"));
	if (!bytes) {
		if (te_sink) te_sink(2, "", 0);
		return;
	}
	if (te_sink) te_sink(kind, bytes, te_utf8_len(bytes));
}

static int te_block_init(void) {
	if (te_block_ready) return 1;
	te_t isa = objc_getClass("__NSGlobalBlock__");
	if (!isa) return 0;
	te_desc.reserved = 0;
	te_desc.size = sizeof(te_block_t);
	te_block.isa = isa;
	te_block.flags = TE_BLOCK_IS_GLOBAL;
	te_block.reserved = 0;
	te_block.invoke = te_invoke;
	te_block.descriptor = &te_desc;
	te_block_ready = 1;
	return 1;
}

static void te_invoke(void *block, void *result, void *error) {
	(void)block;
	if (error) {
		te_t described = ((te_t (*)(void *, void *))objc_msgSend)(
		    error, sel_registerName("localizedDescription"));
		te_emit(1, described);
		return;
	}
	te_emit(0, result);
}

// The one thing the adapter has to be able to prove before it claims to work.
int crust_testing_available(void *web) {
	if (!web) return 0;
	if (!objc_getClass("__NSGlobalBlock__")) return 0;
	return te_has(web, "evaluateJavaScript:completionHandler:");
}

void crust_testing_set_sink(void *sink) {
	te_sink = (void (*)(int, const char *, long long))sink;
}

// 0 started, 1 no webview or no evaluate selector, 2 the script string did not build, 3 the block
// did not build.
int crust_testing_eval(void *web, const char *bytes, long long length) {
	te_t text;
	if (!crust_testing_available(web)) return 1;
	if (!te_block_init()) return 3;
	text = te_nsstring(bytes, length);
	if (!text) return 2;
	((void (*)(void *, void *, te_t, void *))objc_msgSend)(
	    web, sel_registerName("evaluateJavaScript:completionHandler:"), text, (void *)&te_block);
	return 0;
}
