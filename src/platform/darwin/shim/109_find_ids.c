// --- find completion blocks: one per in-flight request id ------------------
// JavaScript can start a second search before the first WebKit completion lands; it fails the
// older promise, but it cannot cancel the older render. With one shared block both completions
// report through the same sink and the newer promise can be answered with the older result. Each
// render here gets its own block carrying its request id. The ring wraps after four supersessions,
// by which time every older promise has already failed.

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

#define FIND_SLOTS 4

static find_block_descriptor find_desc;
static find_block_t find_blocks[FIND_SLOTS];
static int find_ids[FIND_SLOTS];
static int find_block_ready;

static void find_invoke_0(void *block, void *result) {
	(void)block;
	find_finish(find_ids[0], result);
}
static void find_invoke_1(void *block, void *result) {
	(void)block;
	find_finish(find_ids[1], result);
}
static void find_invoke_2(void *block, void *result) {
	(void)block;
	find_finish(find_ids[2], result);
}
static void find_invoke_3(void *block, void *result) {
	(void)block;
	find_finish(find_ids[3], result);
}

static void (*find_invokes[FIND_SLOTS])(void *, void *) = {
    find_invoke_0, find_invoke_1, find_invoke_2, find_invoke_3};

static int find_block_init(void) {
	int i;
	find_t isa;
	if (find_block_ready) return 1;
	isa = objc_getClass("__NSGlobalBlock__");
	if (!isa) return 0;
	find_desc.reserved = 0;
	find_desc.size = sizeof(find_block_t);
	for (i = 0; i < FIND_SLOTS; i++) {
		find_blocks[i].isa = isa;
		find_blocks[i].flags = FIND_BLOCK_IS_GLOBAL;
		find_blocks[i].reserved = 0;
		find_blocks[i].invoke = find_invokes[i];
		find_blocks[i].descriptor = &find_desc;
	}
	find_block_ready = 1;
	return 1;
}

static void *find_block_for(int id) {
	int slot;
	if (!find_block_init()) return 0;
	slot = ((unsigned)id) % FIND_SLOTS;
	find_ids[slot] = id;
	return &find_blocks[slot];
}

int crust_find_block_ready(void) { return find_block_init(); }
