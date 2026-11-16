// --- the completion handler WebView2 calls back into -----------------------
// Every Invoke WebView2 makes is (self, code-or-sender, created-or-args), so one vtable serves the
// environment, the controller and the resource handler. The vtable pointer is the object: COM has
// no other shape, which is why TypeScript never sees one.

typedef struct {
	void **vtbl;
	long refs;
	void *result;
	shim_i64 failed;
	int done;
} shim_handler;

static shim_i64 handler_qi(void *self, const void *iid, void **out) {
	if (!out) return -2147467261LL; /* E_POINTER */
	// Every IID is answered with this object: WebView2 asks only for the handler interface it
	// was handed, and an invented IID table would fail harder than a stable answer.
	(void)iid;
	*out = self;
	((shim_handler *)self)->refs++;
	return 0;
}

static shim_u64 handler_addref(void *self) { return (shim_u64)++((shim_handler *)self)->refs; }

static shim_u64 handler_release(void *self) {
	shim_handler *h = (shim_handler *)self;
	return (shim_u64)--h->refs;
}

static shim_i64 handler_invoke(void *self, shim_i64 code, void *created) {
	shim_handler *h = (shim_handler *)self;
	h->failed = code;
	h->result = created;
	h->done = 1;
	return 0;
}

// The vtable is filled in at run time, never as a static initialiser. A static initialiser holding
// code addresses is a *relocated* pointer inside the image, and that one table was the only such
// pointer in the unit — which is what the crash looked like: the window class took a function
// pointer handed over as an argument and worked, while the first COM callback through this table
// jumped to 0xFFFFFFFFFFFFFFFF (2026-11-16). An assignment is not a relocation.
static void *g_handler_vtbl[4];
static int g_handler_vtbl_bound;

void handler_init(shim_handler *h) {
	if (!g_handler_vtbl_bound) {
		g_handler_vtbl[0] = (void *)handler_qi;
		g_handler_vtbl[1] = (void *)handler_addref;
		g_handler_vtbl[2] = (void *)handler_release;
		g_handler_vtbl[3] = (void *)handler_invoke;
		g_handler_vtbl_bound = 1;
	}
	h->vtbl = g_handler_vtbl;
	h->refs = 1;
	h->result = 0;
	h->failed = 0;
	h->done = 0;
}

// WebView2 completes on this thread's own message queue, so the wait is a PeekMessage drain,
// never a block: a blocked thread never receives the completion and the call times out.
void handler_wait(shim_handler *h, int maxMs) {
	int waited = 0;
	while (!h->done && waited < maxMs) {
		shim_pump();
		Sleep(1);
		waited++;
	}
}
