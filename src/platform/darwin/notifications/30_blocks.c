// --- completion handlers ---------------------------------------------------
// A block is plain memory: { isa, flags, reserved, invoke, descriptor }. A
// GLOBAL block (flags bit 28) needs no copy or dispose helper and no heap, which
// is what makes it constructible from C with no compiler support. The isa is
// found through objc_getClass("__NSGlobalBlock__") rather than the exported
// _NSConcreteGlobalBlock data symbol, so a missing symbol cannot break linking.
#define NF_BLOCK_GLOBAL (1 << 28)

typedef struct {
	unsigned long reserved;
	unsigned long size;
} nf_descriptor;

typedef struct {
	void *isa;
	int flags;
	int reserved;
	void (*invoke)(void *, int, void *); // (^)(BOOL granted, NSError *error)
	void *descriptor;
} nf_auth_block_t;

typedef struct {
	void *isa;
	int flags;
	int reserved;
	void (*invoke)(void *, void *); // (^)(NSError *error)
	void *descriptor;
} nf_job_block_t;

static volatile int nf_auth_done;
static volatile int nf_auth_granted;
static volatile int nf_job_done;
static volatile int nf_job_failed;

// What the OS said when it refused. "Denied" alone hides the difference between a user
// declining and the system refusing an app it does not recognise — `UNErrorDomain code=1`
// with no text is what an unsigned or unregistered bundle gets — so the code and the
// localized description are kept and reported.
static char nf_error_text[NF_REASON_BYTES];
static char nf_error_domain[128];
static int nf_error_code;

static int nf_same(const char *a, const char *b) {
	while (*a && *a == *b) {
		a++;
		b++;
	}
	return *a == *b;
}

static void nf_take_error(void *error) {
	nf_error_text[0] = 0;
	nf_error_domain[0] = 0;
	nf_error_code = 0;
	if (!error) return;
	nf_error_code =
	    (int)((long long (*)(void *, void *))objc_msgSend)(error, sel_registerName("code"));
	void *domain = ((void *(*)(void *, void *))objc_msgSend)(error, sel_registerName("domain"));
	if (domain) {
		const char *utf8 =
		    ((const char *(*)(void *, void *))objc_msgSend)(domain, sel_registerName("UTF8String"));
		if (utf8) nf_set(nf_error_domain, sizeof nf_error_domain, utf8);
	}
	void *description =
	    ((void *(*)(void *, void *))objc_msgSend)(error, sel_registerName("localizedDescription"));
	if (!description) return;
	const char *utf8 =
	    ((const char *(*)(void *, void *))objc_msgSend)(description, sel_registerName("UTF8String"));
	if (utf8) nf_set(nf_error_text, NF_REASON_BYTES, utf8);
}

static void nf_auth_invoke(void *block, int granted, void *error) {
	(void)block;
	nf_auth_granted = granted ? 1 : 0;
	if (!granted) nf_take_error(error);
	nf_auth_done = 1;
}

static void nf_job_invoke(void *block, void *error) {
	(void)block;
	nf_job_failed = error ? 1 : 0;
	nf_job_done = 1;
}

static nf_descriptor nf_auth_desc;
static nf_auth_block_t nf_auth_block;
static nf_descriptor nf_job_desc;
static nf_job_block_t nf_job_block;
static int nf_blocks_ready;

static int nf_blocks_init(void) {
	if (nf_blocks_ready) return 1;
	obj_t isa = objc_getClass("__NSGlobalBlock__");
	if (!isa) return 0;
	nf_auth_desc.reserved = 0;
	nf_auth_desc.size = sizeof(nf_auth_block_t);
	nf_auth_block.isa = isa;
	nf_auth_block.flags = NF_BLOCK_GLOBAL;
	nf_auth_block.reserved = 0;
	nf_auth_block.invoke = nf_auth_invoke;
	nf_auth_block.descriptor = &nf_auth_desc;
	nf_job_desc.reserved = 0;
	nf_job_desc.size = sizeof(nf_job_block_t);
	nf_job_block.isa = isa;
	nf_job_block.flags = NF_BLOCK_GLOBAL;
	nf_job_block.reserved = 0;
	nf_job_block.invoke = nf_job_invoke;
	nf_job_block.descriptor = &nf_job_desc;
	nf_blocks_ready = 1;
	return 1;
}

// The completion handlers run on a private queue, not the main one, so the
// bounded wait is a sleep loop rather than a run-loop pump. Both waits are short
// and only the modern path ever reaches them.
static void nf_wait(volatile int *flag, int millis) {
	int waited = 0;
	while (!*flag && waited < millis) {
		usleep(5000);
		waited += 5;
	}
}

// "crust-<n>": a fresh identifier per post, so a second notification is queued
// beside the first rather than replacing it.
static obj_t nf_identifier(void) {
	char buf[32];
	char digits[12];
	int used = 0;
	int value;
	nf_set(buf, 32, "crust-");
	value = ++nf_counter;
	do {
		digits[used++] = (char)('0' + (value % 10));
		value /= 10;
	} while (value > 0);
	while (used > 0) {
		char one[2];
		one[0] = digits[--used];
		one[1] = 0;
		nf_cat(buf, 32, one);
	}
	return nf_nsstring(buf);
}

