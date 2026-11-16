// --- the completion handler WebView2 calls back into -----------------------
// Every Invoke WebView2 makes is (self, code-or-sender, created-or-args), so one vtable serves the
// environment, the controller and the resource handler. The vtable pointer is the object: COM has
// no other shape, which is why TypeScript never sees one.
//
// The handler is the first hand-built object this layer hands to Windows, and the one place a wrong
// layout is a jump to 0xFFFFFFFFFFFFFFFF rather than a bad return value — so it carries its own
// readback (`shim_handler_*` below) instead of being taken on trust.

typedef struct {
	void **vtbl;
	long refs;
	void *result;
	/** The HRESULT `Invoke` carried. `int`, because that parameter is 32 bits: a wider field stores an
	 * undefined top half of RDX, and a sign test on that makes a successful callback look failed. */
	int failed;
	int done;
	/** What `Invoke` last handed us. Kept across `handler_init`, so "stored then overwritten" is visible. */
	void *created;
	/** The refcount `AddRef` answered for `created`, or 0 / -1 when it was not taken. */
	int addref;
	/** Which thread step this handler's callback belongs to, for `shim_thread_at`. */
	int step;
} shim_handler;

// One translation unit: the readback part reads these two directly.
shim_handler g_env_handler;
shim_handler g_ctrl_handler;

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

/**
 * AddRef through the guarded accessor — slot 1 of the object's own vtable, the same `shim_object_vtbl`
 * path the other call sites use. Returns the refcount, 0 when the object refused, -1 when it could not be
 * read or the slot is not code.
 *
 * **The rule this layer missed for ten rounds:** the out-parameter of a completion handler is *borrowed*.
 * WebView2 drops its reference when our `Invoke` returns, so an object we keep must be AddRef'd first.
 * Without it the environment was freed under us: `CreateCoreWebView2Controller` still answered S_OK inside
 * the callback (the object was alive for that instant), the controller it returned was borrowed too, and
 * by the time we read either one the memory had been recycled — `0xffffffff` where a vtable belongs, a
 * null first field, `UI_E_WRONG_THREAD` from a dead environment, `E_FAIL` from `get_CoreWebView2`.
 *
 * Nothing in this layer calls `Release`: these objects live for the process, the same convention as the
 * loader handle. Do not "balance" this later — that is how the bug comes back.
 */
static int handler_addref_object(void *obj) {
	void **vt = shim_object_vtbl(obj);
	if (!vt) return -1;
	if (!shim_slot_ok(vt, SHIM_SLOT_IUNKNOWN_ADDREF)) return -1;
	return (int)((unsigned int (*)(void *))vt[SHIM_SLOT_IUNKNOWN_ADDREF])(obj);
}

// `Invoke`'s second parameter is a 32-bit HRESULT, so it is declared `int`: the caller sets EDX only,
// and reading 64 bits there stores an undefined top half of RDX in `failed`.
static shim_i64 handler_invoke(void *self, int code, void *created) {
	shim_handler *h = (shim_handler *)self;
	shim_note_thread(h->step);
	h->failed = code;
	h->created = created;
	// AddRef *before* the store: the out-parameter is borrowed and WebView2 drops its reference the
	// moment this returns. `result` stays 0 when the reference could not be taken, so a caller sees "no
	// object" rather than a pointer into recycled memory.
	h->addref = 0;
	if (code == 0 && created) {
		h->addref = handler_addref_object(created);
		h->result = h->addref > 0 ? created : 0;
	} else {
		h->result = 0;
	}
	h->done = 1;
	// The environment's own completion is the frame WebView2 created the environment in. The call is
	// deferred by one statement (`shim_controller_deferred`), never made here: a reentrant call inside a
	// handler is unsupported, and `done` is set first so a slow call cannot keep `handler_wait` spinning.
	if (h->step == SHIM_THREAD_ENV_CALLBACK && code == 0 && h->result)
		shim_controller_from_callback(h->result);
	return 0;
}

// QueryInterface answers every IID, so WebView2 is told this object supports interfaces it does not
// have. If it ever calls one of those, the call must land on something that refuses: an entry past
// the end of the table is whatever followed it in .bss, which is how a call becomes a jump to -1.
static shim_i64 handler_unsupported(void *self) {
	(void)self;
	return -2147467262LL; /* E_NOINTERFACE */
}

// Eight entries, four real: QueryInterface, AddRef, Release, Invoke. The padding is not decoration.
#define SHIM_HANDLER_SLOTS 8

// The vtable is filled in at run time, never as a static initialiser. A static initialiser holding
// code addresses is a *relocated* pointer inside the image, and that one table was the only such
// pointer in the unit — which is what the crash looked like: the window class took a function
// pointer handed over as an argument and worked, while the first COM callback through this table
// jumped to 0xFFFFFFFFFFFFFFFF (2026-11-16). An assignment is not a relocation.
static void *g_handler_vtbl[SHIM_HANDLER_SLOTS];
static int g_handler_vtbl_bound;

void handler_init(shim_handler *h, int step) {
	int slot;
	if (!g_handler_vtbl_bound) {
		g_handler_vtbl[0] = (void *)handler_qi;
		g_handler_vtbl[1] = (void *)handler_addref;
		g_handler_vtbl[2] = (void *)handler_release;
		g_handler_vtbl[3] = (void *)handler_invoke;
		for (slot = 4; slot < SHIM_HANDLER_SLOTS; slot++)
			g_handler_vtbl[slot] = (void *)handler_unsupported;
		g_handler_vtbl_bound = 1;
	}
	h->vtbl = g_handler_vtbl;
	h->refs = 1;
	h->result = 0;
	h->failed = 0;
	h->done = 0;
	h->step = step;
}

// --- readback ---------------------------------------------------------------
// What Windows will read out of the object, as numbers: the table's address, and each entry. A probe
// prints them, so "the object's first field is not the table" is a line of output rather than a guess.
shim_i64 shim_handler_vtbl_addr(void) { return (shim_i64)(void *)g_handler_vtbl; }

shim_i64 shim_handler_entry(int index) {
	if (index < 0 || index >= SHIM_HANDLER_SLOTS) return 0;
	return (shim_i64)(void *)g_handler_vtbl[index];
}

// WebView2 completes on this thread's own message queue, so the wait is a PeekMessage drain, never a
// block: a blocked thread never receives the completion and the call times out.
// The bound is a real deadline, not an iteration count: `Sleep(1)` rounds up to the ~15.6 ms timer tick
// on Windows, so 5000 iterations of it measured ~48 s and a timeout cost the whole run.
void handler_wait(shim_handler *h, int maxMs) {
	shim_u64 deadline;
	if (h->done) return;
	deadline = (GetTickCount64 ? GetTickCount64() : 0) + (shim_u64)maxMs;
	while (!h->done) {
		shim_pump();
		if (!GetTickCount64 || GetTickCount64() >= deadline) return;
		Sleep(1);
	}
}
