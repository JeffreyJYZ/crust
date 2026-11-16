// --- is that pointer readable, and is that entry callable? ------------------
// A vtable helper used to dereference its object before any check ran, so a `ctrl` of `(void *)-1`
// faulted on `*(void ***)ctrl` — reading `0xFFFFFFFFFFFFFFFF`, which is the address in the panic. That
// cannot distinguish "the object pointer is garbage" from "the object is fine and one entry is bad",
// and those are different defects with different fixes.
//
// So there are two questions, and `shim_object_vtbl` is the only place a vtable is taken from an object:
//
//   shim_is_readable  — may these bytes be read at all (MEM_COMMIT, not NOACCESS, not GUARD)
//   shim_is_code      — may this address be called (committed, PAGE_EXECUTE*)
//
// MEMORY_BASIC_INFORMATION is 48 bytes on x64 and has no header here: State sits at byte 32 and Protect
// at byte 36.
#define SHIM_OBJ_OK 0
#define SHIM_OBJ_UNREADABLE 1
#define SHIM_OBJ_VTBL_UNREADABLE 2
#define SHIM_OBJ_SLOT_NOT_CODE 3

static int g_bad_object = SHIM_OBJ_OK;
static int g_bad_slot = -1;

/** The last refusal: 0 fine, 1 object unreadable, 2 vtable unreadable, 3 slot not code. */
int shim_bad_object(void) { return g_bad_object; }

/** The last slot a call refused, or -1. Printed after every stage, so "we did not call it" is visible. */
int shim_bad_slot(void) { return g_bad_slot; }

int shim_is_readable(const void *address) {
	shim_u64 info[6];
	if (!address || address == (const void *)-1) return 0;
	if (!VirtualQuery) return 0;
	if ((shim_u64)VirtualQuery(address, info, sizeof info) != sizeof info) return 0;
	if ((*(unsigned int *)((const char *)info + 32) & 0x1000u) == 0) return 0; /* MEM_COMMIT */
	if (*(unsigned int *)((const char *)info + 36) & 0x101u) return 0; /* NOACCESS | GUARD */
	return 1;
}

int shim_is_code(const void *address) {
	shim_u64 info[6];
	if (!address || address == (const void *)-1) return 0;
	if (!VirtualQuery) return 0;
	if ((shim_u64)VirtualQuery(address, info, sizeof info) != sizeof info) return 0;
	if ((*(unsigned int *)((const char *)info + 32) & 0x1000u) == 0) return 0; /* MEM_COMMIT */
	if ((*(unsigned int *)((const char *)info + 36) & 0xF0u) == 0) return 0; /* PAGE_EXECUTE* */
	return 1;
}

/** 0 when `obj` reads and its first field reads, 1 when `obj` does not, 2 when the vtable does not. */
int shim_object_state(void *obj) {
	void **vt;
	if (!shim_is_readable(obj)) return SHIM_OBJ_UNREADABLE;
	vt = *(void ***)obj;
	if (!shim_is_readable(vt)) return SHIM_OBJ_VTBL_UNREADABLE;
	return SHIM_OBJ_OK;
}

/**
 * The vtable pointer of `obj`, or 0 when the object itself cannot be read. **Every** call site takes
 * its vtable through this: a site that writes `*(void ***)obj` directly is the panic coming back.
 */
void **shim_object_vtbl(void *obj) {
	void **vt;
	g_bad_object = SHIM_OBJ_OK;
	g_bad_slot = -1;
	if (!shim_is_readable(obj)) {
		g_bad_object = SHIM_OBJ_UNREADABLE;
		return 0;
	}
	vt = *(void ***)obj;
	if (!shim_is_readable(vt)) {
		g_bad_object = SHIM_OBJ_VTBL_UNREADABLE;
		return 0;
	}
	return vt;
}

/** 1 when `vt[index]` may be called. Records the index and the reason otherwise. */
int shim_slot_ok(void **vt, int index) {
	if (!vt) {
		g_bad_slot = index;
		return 0;
	}
	if (!shim_is_code(vt[index])) {
		g_bad_object = SHIM_OBJ_SLOT_NOT_CODE;
		g_bad_slot = index;
		return 0;
	}
	return 1;
}
