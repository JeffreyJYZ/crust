// --- crust testing: run a script in a page and hand its answer back ---------
// `-evaluateJavaScript:completionHandler:` takes a block, which may not cross bun:ffi, so this unit
// builds a STACK block by hand: plain memory { isa, flags, reserved, invoke, descriptor, id } with
// isa `_NSConcreteStackBlock` and no BLOCK_HAS_SIGNATURE bit. WebKit copies the block before it
// stores the handler, and the copy carries the request id captured at send time.
//
// Each evaluation owns its own block, so a late answer can never be rewritten under a newer id —
// the old table wrote the id into a slot by `id % 64` and read it at completion time, which let a
// timed-out answer settle a newer command after the slot wrapped. There is no table and no slot:
// the correlation is a value inside the block WebKit keeps, not a shared index. Everything reaches
// the sink as strings: the page's own snippets return JSON, and JSON is the one shape that survives
// the boundary without an object graph. An NSError is kind 1 with the localised message; a nil
// result is kind 2.

typedef void *te_t;

extern te_t objc_msgSend(void *self, void *sel, ...);
extern te_t objc_getClass(const char *name);
extern te_t sel_registerName(const char *name);
extern void _NSConcreteStackBlock;

// The block ABI's descriptor is reserved, size, copy, dispose. `_Block_copy` reads `copy` even when
// it is null, so the descriptor must have all four fields — a two-field one reads past its end.
typedef struct {
	unsigned long reserved;
	unsigned long size;
	void *copy;
	void *dispose;
} te_block_descriptor;

// (^)(id result, NSError *error) — the block itself is the hidden first argument. The trailing id
// is a block capture: extra fields after `descriptor` are part of the block ABI, not a corruption.
typedef struct {
	void *isa;
	int flags;
	int reserved;
	void (*invoke)(void *, void *, void *);
	void *descriptor;
	long long id;
} te_block_t;

static te_block_descriptor te_desc;

// The JSCallback bun:ffi hands out: kind, bytes, length, request id.
static void (*te_sink)(int kind, const char *bytes, long long length, long long id) = 0;

// Ownership rule, the same one the shim uses: -alloc/-init answers a +1 object, so each caller
// balances it with exactly one -release. WebKit copies the script string for the evaluation.
static void te_release(te_t object) {
	if (object) ((void (*)(void *, void *))objc_msgSend)(object, sel_registerName("release"));
}

// The copied block is passed as the invoke's first argument, so the id read here is the one
// captured when the request was sent — never a later request's id in a reused slot.
static void te_invoke(void *block, void *result, void *error);

static int te_has(void *obj, const char *name) {
	if (!obj) return 0;
	return (int)(char)((char (*)(void *, void *, void *))objc_msgSend)(
	    obj, sel_registerName("respondsToSelector:"), sel_registerName(name));
}

// NSString from a byte range: encoding 4 is NSUTF8StringEncoding, and a JS string cannot cross, so
// every script arrives as bytes. The NSString owns a copy, so the JS buffer may be released as soon
// as this returns.
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
static void te_emit(int kind, te_t object, long long id) {
	const char *bytes;
	if (!object || !te_has(object, "UTF8String")) {
		if (te_sink) te_sink(2, "", 0, id);
		return;
	}
	bytes = ((const char *(*)(void *, void *))objc_msgSend)(object,
	                                                        sel_registerName("UTF8String"));
	if (!bytes) {
		if (te_sink) te_sink(2, "", 0, id);
		return;
	}
	if (te_sink) te_sink(kind, bytes, te_utf8_len(bytes), id);
}

static void te_invoke(void *block, void *result, void *error) {
	long long id = ((te_block_t *)block)->id;
	if (error) {
		te_t described = ((te_t (*)(void *, void *))objc_msgSend)(
		    error, sel_registerName("localizedDescription"));
		te_emit(1, described, id);
		return;
	}
	te_emit(0, result, id);
}

// The one thing the adapter has to be able to prove before it claims to work.
int crust_testing_available(void *web) {
	if (!web) return 0;
	return te_has(web, "evaluateJavaScript:completionHandler:");
}

void crust_testing_set_sink(void *sink) {
	te_sink = (void (*)(int, const char *, long long, long long))sink;
}

// 0 started, 1 no webview or no evaluate selector, 2 the script string did not build.
// `id` lives inside the block WebKit copies, so every completion echoes the id that was current
// when its own request was sent. A late answer cannot inherit a newer command's id.
int crust_testing_eval(void *web, const char *bytes, long long length, long long id) {
	te_t text;
	te_block_t block;
	if (!crust_testing_available(web)) return 1;
	text = te_nsstring(bytes, length);
	if (!text) return 2;

	te_desc.reserved = 0;
	te_desc.size = sizeof(te_block_t);
	te_desc.copy = 0;
	te_desc.dispose = 0;
	block.isa = &_NSConcreteStackBlock;
	block.flags = 0;
	block.reserved = 0;
	block.invoke = te_invoke;
	block.descriptor = &te_desc;
	block.id = id;
	((void (*)(void *, void *, te_t, void *))objc_msgSend)(
	    web, sel_registerName("evaluateJavaScript:completionHandler:"), text, (void *)&block);
	// WebKit copied the script for the evaluation; our +1 ends here.
	te_release(text);
	return 0;
}
