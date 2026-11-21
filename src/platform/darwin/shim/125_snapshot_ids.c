// --- snapshot completion blocks: one per in-flight capture id ----------------
// A page can ask for two captures in the same tick. JavaScript fails the older promise, but it
// cannot cancel the older WebKit render, and both completions arrive through the one C sink. With
// a single block the second completion's picture and id are indistinguishable from the first's:
// the surviving promise is answered with the older window's image. A small ring of blocks, each
// carrying the id of the render it was handed to, lets the sink name the render it finished so the
// caller can drop a stale completion. The ring wraps after four supersessions, by which time every
// older promise has already failed, so a reused block cannot answer a live promise with stale bytes.

typedef struct {
	unsigned long reserved;
	unsigned long size;
} shot_block_descriptor;

// (^)(NSImage *image, NSError *error) — the block itself is the hidden first argument.
typedef struct {
	void *isa;
	int flags;
	int reserved;
	void (*invoke)(void *, void *, void *);
	void *descriptor;
} shot_block_t;

#define SHOT_SLOTS 4

static shot_block_descriptor shot_desc;
static shot_block_t shot_blocks[SHOT_SLOTS];
static int shot_ids[SHOT_SLOTS];
static int shot_block_ready;

static void shot_invoke_0(void *block, void *image, void *error) {
	(void)block;
	shot_finish(image, error, shot_ids[0]);
}
static void shot_invoke_1(void *block, void *image, void *error) {
	(void)block;
	shot_finish(image, error, shot_ids[1]);
}
static void shot_invoke_2(void *block, void *image, void *error) {
	(void)block;
	shot_finish(image, error, shot_ids[2]);
}
static void shot_invoke_3(void *block, void *image, void *error) {
	(void)block;
	shot_finish(image, error, shot_ids[3]);
}

static void (*shot_invokes[SHOT_SLOTS])(void *, void *, void *) = {
    shot_invoke_0, shot_invoke_1, shot_invoke_2, shot_invoke_3};

static int shot_block_init(void) {
	int i;
	shot_t isa;
	if (shot_block_ready) return 1;
	isa = objc_getClass("__NSGlobalBlock__");
	if (!isa) return 0;
	shot_desc.reserved = 0;
	shot_desc.size = sizeof(shot_block_t);
	for (i = 0; i < SHOT_SLOTS; i++) {
		shot_blocks[i].isa = isa;
		shot_blocks[i].flags = SHOT_BLOCK_IS_GLOBAL;
		shot_blocks[i].reserved = 0;
		shot_blocks[i].invoke = shot_invokes[i];
		shot_blocks[i].descriptor = &shot_desc;
	}
	shot_block_ready = 1;
	return 1;
}

/** The block WebKit should call for this generation, or 0 when this system cannot build one. */
static void *shot_block_for(int id) {
	int slot;
	if (!shot_block_init()) return 0;
	slot = ((unsigned)id) % SHOT_SLOTS;
	shot_ids[slot] = id;
	return &shot_blocks[slot];
}
