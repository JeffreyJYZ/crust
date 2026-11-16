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

// 0 STA, 1 MTA, 2 neutral, 3 main STA, -1 when the call failed. `1` is MTA: reading it as STA inverts
// the verdict.
int shim_apartment_type(void) {
	int type = 0;
	g_apartment_type = -1;
	g_apartment_hresult = 0;
	if (!CoGetApartmentType) return -1;
	g_apartment_hresult = CoGetApartmentType(&type, 0);
	if (g_apartment_hresult != 0) return -1;
	g_apartment_type = type;
	return type;
}

// 1 when `CoGetApartmentType` resolved at all, so a binding failure is not mistaken for a bad apartment.
int shim_apartment_bound(void) { return CoGetApartmentType ? 1 : 0; }

// The raw HRESULT of the last `shim_apartment_type` call: 0x800401F0 (CO_E_NOTINITIALIZED) is a
// different diagnosis from "the symbol was never bound", which `shim_apartment_bound` answers.
shim_i64 shim_apartment_hresult(void) { return (shim_i64)g_apartment_hresult; }

// The two objects the controller path holds. Equal addresses mean the wrong one was stored.
void *shim_controller_addr(void) { return shim_controller_handle(); }
void *shim_environment_addr(void) { return shim_environment_handle(); }

// The vtable pointer Windows will read out of the controller, and one entry of it. Compared against
// `shim_handler_vtbl_addr()` this says whether the object is a controller at all.
void *shim_controller_vtbl(void) {
	void *ctrl = shim_controller_handle();
	if (!ctrl) return 0;
	return *(void **)ctrl;
}

void *shim_controller_slot(int index) {
	void *ctrl = shim_controller_handle();
	void **vt;
	if (!ctrl || index < 0 || index >= 32) return 0;
	vt = *(void ***)ctrl;
	return vt[index];
}
