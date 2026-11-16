// --- is that pointer callable? ---------------------------------------------
// A vtable entry is only called when it is committed executable memory. `0`, `(void *)-1` and garbage
// are refused and recorded instead of jumped to, so one bad object cannot end the run: a probe that can
// still print the next line is worth far more than one that panics.
//
// MEMORY_BASIC_INFORMATION is 48 bytes on x64 and has no header here: State sits at byte 32
// (MEM_COMMIT = 0x1000) and Protect at byte 36, where the PAGE_EXECUTE* flags are the 0xF0 mask.
static int g_bad_slot = -1;

// The last slot a call refused, or -1. Printed after every stage, so "we did not call it" is visible.
int shim_bad_slot(void) { return g_bad_slot; }

int shim_is_code(const void *address) {
	shim_u64 info[6];
	if (!address || address == (const void *)-1) return 0;
	if (!VirtualQuery) return 0;
	if ((shim_u64)VirtualQuery(address, info, sizeof info) != sizeof info) return 0;
	if ((*(unsigned int *)((const char *)info + 32) & 0x1000u) == 0) return 0;
	if ((*(unsigned int *)((const char *)info + 36) & 0xF0u) == 0) return 0;
	return 1;
}

// 1 when `vt[index]` may be called. Records the index otherwise, so the refusal has a name.
int shim_slot_ok(void **vt, int index) {
	if (!vt) {
		g_bad_slot = index;
		return 0;
	}
	if (!shim_is_code(vt[index])) {
		g_bad_slot = index;
		return 0;
	}
	return 1;
}
