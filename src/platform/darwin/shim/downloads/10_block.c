// --- downloads: the two blocks WebKit asks for ------------------------------
// bun:ffi cannot carry a block, and TinyCC has no -fblocks, so both are hand-built global blocks:
// isa, flags (BLOCK_IS_GLOBAL), reserved, invoke, descriptor. `_Block_copy` reads the descriptor's
// size, and copying a global block returns the same pointer, so WebKit may keep it indefinitely.
// The invoke is C; the only state either one needs is this unit's own statics.

struct dl_block {
	void *isa;
	int flags;
	int reserved;
	void *invoke;
	void *descriptor;
};

struct dl_descriptor {
	unsigned long reserved;
	unsigned long size;
	void *copy;
	void *dispose;
};

static void dl_start_done(void *block, obj_t download);
static void dl_cancel_done(void *block, obj_t resume);

static struct dl_descriptor dl_descriptor = {0, sizeof(struct dl_block), 0, 0};
static struct dl_block dl_start_block = {&_NSConcreteGlobalBlock, 0x10000000, 0, dl_start_done,
                                         &dl_descriptor};
static struct dl_block dl_cancel_block = {&_NSConcreteGlobalBlock, 0x10000000, 0, dl_cancel_done,
                                          &dl_descriptor};

// Call a block WebKit handed over: its invoke field is the function, the block itself the first
// argument, and the payload the second.
static void dl_call_block(obj_t block, obj_t argument) {
	void *invoke;
	if (!block) return;
	invoke = ((struct dl_block *)block)->invoke;
	if (!invoke) return;
	((void (*)(void *, obj_t))invoke)(block, argument);
}
