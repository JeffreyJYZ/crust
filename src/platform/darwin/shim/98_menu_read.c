// --- menu api, readback ----------------------------------------------------
// Part 2 of `98_menu_api.c`, concatenated into that unit so it shares its helpers and
// statics: it compiles nowhere alone. It reads `-[NSApp mainMenu]` — the menu AppKit
// holds, not the spec that asked for it — and flattens it, because no struct crosses
// bun:ffi. Root rows come first, then each row's children; `parent` is an index.
// One level only: a deeper submenu is not walked, and a caller sees `hasSubmenu`.

#define MENU_READ_MAX 64
#define MENU_READ_BYTES 256
static obj_t menu_read_rows[MENU_READ_MAX];
static int menu_read_parent[MENU_READ_MAX];
static int menu_read_count;
static char menu_read_buf[MENU_READ_BYTES];

static obj_t menu_read_main(void) {
	obj_t app = menu_app();
	if (!app || !menu_responds(app, "mainMenu")) return 0;
	return ((obj_t (*)(void *, void *))objc_msgSend)(app, sel_registerName("mainMenu"));
}

static long long menu_read_total(obj_t menu) {
	if (!menu || !menu_responds(menu, "numberOfItems")) return 0;
	return ((long long (*)(void *, void *))objc_msgSend)(menu, sel_registerName("numberOfItems"));
}

static obj_t menu_read_at(obj_t menu, long long index) {
	if (!menu || !menu_responds(menu, "itemAtIndex:")) return 0;
	return ((obj_t (*)(void *, void *, long long))objc_msgSend)(
	    menu, sel_registerName("itemAtIndex:"), index);
}

static obj_t menu_read_submenu(obj_t row) {
	if (!row || !menu_responds(row, "submenu")) return 0;
	return ((obj_t (*)(void *, void *))objc_msgSend)(row, sel_registerName("submenu"));
}

static int menu_read_push(obj_t row, int parent) {
	if (!row || menu_read_count >= MENU_READ_MAX) return -1;
	int at = menu_read_count++;
	menu_read_rows[at] = row;
	menu_read_parent[at] = parent;
	return at;
}

// The whole bar, flattened. -1 means AppKit holds no main menu at all, which is a
// different answer from an empty one and is what `reset` is measured against.
int menu_api_read(void) {
	menu_read_count = 0;
	obj_t main_menu = menu_read_main();
	if (!main_menu) return -1;
	long long roots = menu_read_total(main_menu);
	for (long long i = 0; i < roots; i++) {
		obj_t row = menu_read_at(main_menu, i);
		int at = menu_read_push(row, -1);
		if (at < 0) return menu_read_count;
		obj_t submenu = menu_read_submenu(row);
		long long kids = menu_read_total(submenu);
		for (long long j = 0; j < kids; j++) {
			if (menu_read_push(menu_read_at(submenu, j), at) < 0) return menu_read_count;
		}
	}
	return menu_read_count;
}

static obj_t menu_read_row(int index) {
	if (index < 0 || index >= menu_read_count) return 0;
	return menu_read_rows[index];
}

// -1 for a bar row, -2 for an index no read produced; a caller that ignores the
// difference still assembles a tree, because both are "no parent".
int menu_api_read_parent(int index) {
	if (index < 0 || index >= menu_read_count) return -2;
	return menu_read_parent[index];
}

// A BOOL selector, or -1 when this AppKit has no such selector: absent is not false.
static int menu_read_flag(obj_t row, const char *selname) {
	if (!row || !menu_responds(row, selname)) return -1;
	return (int)(char)((char (*)(void *, void *))objc_msgSend)(row, sel_registerName(selname));
}

int menu_api_read_enabled(int index) { return menu_read_flag(menu_read_row(index), "isEnabled"); }

int menu_api_read_has_submenu(int index) {
	return menu_read_flag(menu_read_row(index), "hasSubmenu");
}

// NSEventModifierFlags of the live row; AppKit defaults a row with no accelerator to
// Command alone, and that default is exactly what a readback of the spec would miss.
long long menu_api_read_mask(int index) {
	obj_t row = menu_read_row(index);
	if (!row || !menu_responds(row, "keyEquivalentModifierMask")) return -1;
	return (long long)((unsigned long (*)(void *, void *))objc_msgSend)(
	    row, sel_registerName("keyEquivalentModifierMask"));
}

// An NSString's bytes copied into static storage, returned as `const char *` so no
// object crosses the boundary; bounded by MENU_READ_BYTES and read before the next call.
static const char *menu_read_string(obj_t row, const char *selname) {
	menu_read_buf[0] = 0;
	if (!row || !menu_responds(row, selname)) return menu_read_buf;
	obj_t text = ((obj_t (*)(void *, void *))objc_msgSend)(row, sel_registerName(selname));
	if (!text || !menu_responds(text, "UTF8String")) return menu_read_buf;
	const char *utf8 =
	    ((const char *(*)(void *, void *))objc_msgSend)(text, sel_registerName("UTF8String"));
	if (!utf8) return menu_read_buf;
	long i = 0;
	while (utf8[i] && i < MENU_READ_BYTES - 1) {
		menu_read_buf[i] = utf8[i];
		i++;
	}
	menu_read_buf[i] = 0;
	return menu_read_buf;
}

const char *menu_api_read_title(int index) {
	return menu_read_string(menu_read_row(index), "title");
}

const char *menu_api_read_key(int index) {
	return menu_read_string(menu_read_row(index), "keyEquivalent");
}

// Defined here, before 99_menu_context.c is concatenated into the same unit; that part marks it
// when crust installs the default bar, and this part compares against it.
static obj_t menu_default_bar = 0;

// Is the live bar the one crust installed, by pointer identity. A shape check (two roots, the
// first titled after the app) let a caller-built bar claim to be the default after it had thrown
// away the documented ⌘C/⌘V/⌘Q rows. `app_name` stays in the ABI for the readback caller but is
// no longer the test: identity cannot be forged from page-visible data.
int menu_api_is_default(const char *app_name, long long len) {
	(void)app_name;
	(void)len;
	obj_t main_menu = menu_read_main();
	return main_menu && menu_default_bar && main_menu == menu_default_bar ? 1 : 0;
}
