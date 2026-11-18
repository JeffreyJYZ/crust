// --- downloads: the two blocks WebKit asks for -----------------------------------------
// bun:ffi cannot carry a block, and TinyCC has no -fblocks, so both are hand-built: isa, flags,
// reserved, invoke, descriptor. The cancel block is global (copying it returns the same pointer);
// each start gets a stack block carrying its own token, so WebKit's copy keeps that identity.
// The invoke is C; the only other state either one needs is this unit's own statics.

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

// The token lives in the block WebKit keeps, never in a FIFO queue: WebKit promises no ordering for
// completion handlers (native-surface.md §4, measured 2026-11-18). A stack block carries its token
// through _Block_copy into the heap block the completion invokes. One bounded slot per start.
struct dl_start_block {
	struct dl_block base;
	long long token;
};
static struct dl_descriptor dl_descriptor = {0, sizeof(struct dl_block), 0, 0};
static struct dl_descriptor dl_start_descriptor = {0, sizeof(struct dl_start_block), 0, 0};
static struct dl_start_block dl_start_blocks[DL_SLOTS];
static struct dl_block dl_cancel_block = {&_NSConcreteGlobalBlock, 0x10000000, 0, dl_cancel_done,
                                           &dl_descriptor};

void *dl_start_block_for(long long token) {
	int i;
	for (i = 0; i < DL_SLOTS; i++) {
		struct dl_start_block *b = &dl_start_blocks[i];
		if (b->base.invoke) continue;
		b->base.isa = &_NSConcreteStackBlock;
		b->base.flags = 0;
		b->base.reserved = 0;
		b->base.invoke = dl_start_done;
		b->base.descriptor = &dl_start_descriptor;
		b->token = token;
		return b;
	}
	return 0;
}

void dl_start_block_done(long long token) {
	int i;
	for (i = 0; i < DL_SLOTS; i++) {
		struct dl_start_block *b = &dl_start_blocks[i];
		if (b->base.invoke && b->token == token) {
			b->base.invoke = 0;
			b->token = 0;
			return;
		}
	}
}

// Call a block WebKit handed over: its invoke field is the function, the block itself the first
// argument, and the payload the second.
static void dl_call_block(obj_t block, obj_t argument) {
	void *invoke;
	if (!block) return;
	invoke = ((struct dl_block *)block)->invoke;
	if (!invoke) return;
	((void (*)(void *, obj_t))invoke)(block, argument);
}
