// --- what a probe reads back -----------------------------------------------
// Every number here exists because a call in this layer failed in a way only a pointer explains: a jump
// to 0xFFFFFFFFFFFFFFFF is a vtable read past its end, or an object that is not the one it claims to
// be. Printing them before the call turns each of those into a visible equality.
//
// `CoGetApartmentType` is `int`, not `shim_i64`: it returns a 32-bit HRESULT and a wider declaration
// reads an undefined top half of RAX. `-1` used to mean three different things, so the binding and the
// raw HRESULT are separate exports now.

static int g_apartment_hresult;
static int g_apartment_type;
static int g_apartment_qualifier;

// 0 STA, 1 MTA, 2 neutral, 3 main STA, -1 when the call failed. `1` is MTA: reading it as STA inverts
// the verdict.
int shim_apartment_type(void) {
	int type = 0;
	int qualifier = 0;
	g_apartment_type = -1;
	g_apartment_qualifier = 0;
	g_apartment_hresult = 0;
	if (!CoGetApartmentType) return -1;
	// Two real out-params: the qualifier is not optional, and passing NULL answered E_INVALIDARG
	// (0x80070057) on the runner — which read as "not initialised" for two runs.
	g_apartment_hresult = CoGetApartmentType(&type, &qualifier);
	if (g_apartment_hresult != 0) return -1;
	g_apartment_type = type;
	g_apartment_qualifier = qualifier;
	return type;
}

/** APTTYPEQUALIFIER beside the type: 0 none, 1 implicit MTA, 2 STA by NTA, 3 NA, 4 main STA, … */
int shim_apartment_qualifier(void) { return g_apartment_qualifier; }

// 1 when `CoGetApartmentType` resolved at all, so a binding failure is not mistaken for a bad apartment.
int shim_apartment_bound(void) { return CoGetApartmentType ? 1 : 0; }

// The raw HRESULT of the last `shim_apartment_type` call: 0x800401F0 (CO_E_NOTINITIALIZED) is a
// different diagnosis from "the symbol was never bound", which `shim_apartment_bound` answers.
shim_i64 shim_apartment_hresult(void) { return (shim_i64)g_apartment_hresult; }

// The two objects the controller path holds. Equal addresses mean the wrong one was stored.
/**
 * The first `words` 32-bit words of `obj`, written into a caller-owned buffer, or 0 when the object is
 * unreadable. "Not a COM object" is provable this way rather than inferred: ASCII, a small integer, or a
 * duplicate of the handler table each names what was actually stored.
 */
int shim_object_bytes(void *obj, void *out, int words) {
	unsigned int *dst = (unsigned int *)out;
	const unsigned int *src;
	int i;
	if (!dst || words <= 0 || !shim_is_readable(obj)) return 0;
	src = (const unsigned int *)obj;
	for (i = 0; i < words; i++) dst[i] = src[i];
	return i;
}

void *shim_controller_addr(void) { return shim_controller_handle(); }
void *shim_environment_addr(void) { return shim_environment_handle(); }

// The vtable pointer Windows will read out of the controller, and one entry of it. Compared against
// `shim_handler_vtbl_addr()` this says whether the object is a controller at all.
void *shim_controller_vtbl(void) {
	return (void *)shim_object_vtbl(shim_controller_handle());
}

void *shim_controller_slot(int index) {
	void **vt = shim_object_vtbl(shim_controller_handle());
	if (!vt || index < 0 || index >= 32) return 0;
	return vt[index];
}
