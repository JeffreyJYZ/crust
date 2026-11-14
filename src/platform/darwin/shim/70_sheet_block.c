// --- sheet completion: a hand-built global block ---------------------------
// `beginSheetModalForWindow:completionHandler:` takes a block, and a sheet started with a NULL one can only ever be started — which is what this path did until now. A block is plain memory, { isa, flags, reserved, invoke, descriptor }; a GLOBAL block (isa `__NSGlobalBlock__`, bit 28) needs no copy or dispose helper and no heap, so C builds it with no compiler support and `Block_copy` is a documented no-op.
// Bit 30 is BLOCK_HAS_SIGNATURE, and setting it without a real signature makes the runtime read past this struct, so it is never set. The isa comes from objc_getClass rather than the `_NSConcreteGlobalBlock` data symbol, so a missing symbol cannot break linking; `notifications.c` builds its two handlers the same way, measured working.
#define SHIM_BLOCK_IS_GLOBAL (1 << 28)

typedef struct {
	unsigned long reserved;
	unsigned long size;
} shim_block_descriptor;

// (^)(NSModalResponse response) — NSInteger, so long long on arm64. The block
// itself is the hidden first argument, exactly as the runtime sends it.
typedef struct {
	void *isa;
	int flags;
	int reserved;
	void (*invoke)(void *, long long);
	void *descriptor;
} shim_sheet_block_t;

static shim_block_descriptor panel_sheet_desc;
static shim_sheet_block_t panel_sheet_block;
static int panel_sheet_block_ready;

static void panel_sheet_invoke(void *block, long long response);

static int panel_sheet_block_init(void) {
	if (panel_sheet_block_ready) return 1;
	obj_t isa = objc_getClass("__NSGlobalBlock__");
	if (!isa) return 0;
	panel_sheet_desc.reserved = 0;
	panel_sheet_desc.size = sizeof(shim_sheet_block_t);
	panel_sheet_block.isa = isa;
	panel_sheet_block.flags = SHIM_BLOCK_IS_GLOBAL;
	panel_sheet_block.reserved = 0;
	panel_sheet_block.invoke = panel_sheet_invoke;
	panel_sheet_block.descriptor = &panel_sheet_desc;
	panel_sheet_block_ready = 1;
	return 1;
}

// Runs on the main thread when the sheet ends, by either route: the user's
// click, or the -cancel: shim_sheet_cancel() sends. Recording the response
// first and the done flag last is what makes a JS read after `done` always see
// the response and the paths together. NSModalResponseOK is 1, and the live
// panel's class decides which read collects the answer.
static void panel_sheet_invoke(void *block, long long response) {
	(void)block;
	panel_sheet_response = response;
	if (response == 1 && panel_sheet_panel) {
		if (panel_sheet_is_save) panel_collect_save(panel_sheet_panel);
		else panel_collect(panel_sheet_panel);
	}
	panel_sheet_done = 1;
}

// The window a sheet attaches to. `-keyWindow` is nil whenever the process is
// not the active app — which an unbundled `bun` process frequently is, because
// macOS 14+ restricts self-activation — so falling back to the main window and
// then the first visible window is what makes a picker work from the background
// rather than answer "no window". A sheet on an off-screen window raises, so
// the fallback only accepts a visible one.
static obj_t panel_visible_window(obj_t app) {
	if (!panel_has_instance("NSApplication", "windows")) return 0;
	obj_t list =
	    ((obj_t (*)(void *, void *))objc_msgSend)(app, sel_registerName("windows"));
	if (!list) return 0;
	int guarded = panel_has_instance("NSWindow", "isVisible");
	unsigned long long n = ((unsigned long long (*)(void *, void *))objc_msgSend)(
	    list, sel_registerName("count"));
	for (unsigned long long i = 0; i < n; i++) {
		obj_t w = ((obj_t (*)(void *, void *, unsigned long long))objc_msgSend)(
		    list, sel_registerName("objectAtIndex:"), i);
		if (!w) continue;
		if (!guarded) return w;
		if ((char)((char (*)(void *, void *))objc_msgSend)(w, sel_registerName("isVisible")))
			return w;
	}
	return 0;
}

static obj_t panel_sheet_window(obj_t app) {
	obj_t w = 0;
	if (panel_has_instance("NSApplication", "keyWindow"))
		w = ((obj_t (*)(void *, void *))objc_msgSend)(app, sel_registerName("keyWindow"));
	if (!w && panel_has_instance("NSApplication", "mainWindow"))
		w = ((obj_t (*)(void *, void *))objc_msgSend)(app, sel_registerName("mainWindow"));
	if (!w) w = panel_visible_window(app);
	return w;
}

// The window a sheet attaches to, for either panel class. Returns 0 when this
// process has no window at all, which is what keeps -runModal the fallback.
static int panel_sheet_target(obj_t *out) {
	obj_t app = 0;
	if (shim_responds((obj_t)objc_getClass("NSApplication"),
	                  sel_registerName("sharedApplication"))) {
		app = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSApplication"),
		                                               sel_registerName("sharedApplication"));
	}
	if (!app) return 0;
	*out = panel_sheet_window(app);
	return *out ? 1 : 0;
}

// Opens an NSOpenPanel. `runModal = 1` calls -runModal and BLOCKS this thread until the user answers, stopping the JavaScript thread and the pump — stated as blocking rather than dressed up as async. `runModal = 0` sheets with a real completion handler and returns at once with SHIM_PANEL_SHEET_STARTED: the handler records the NSModalResponse, copies -URLs and sets the done flag, so the caller polls shim_sheet_done() while pump and bridge run. With no key window it answers SHIM_PANEL_NO_WINDOW without sending.
