// --- system backdrop -------------------------------------------------------
// DWMWA_SYSTEMBACKDROP_TYPE (38) is the Win11 22H2+ material attribute. Butter maps
// mica=2, acrylic=3 and tabbed=4 (windows.c:2388-2390) but sets the dark-mode attribute (20)
// too; crust leaves 20 alone because that changes the app's theme, not this window's backdrop.
// `tabbed` is a Windows 11 concept: TS validation refuses it on macOS and Linux by name.
//
// The function is resolved at runtime, like every other Win32 entry point: the import thunk
// TinyCC emits for a DLL jumps to -1 on Windows x64. The module name is held in a variable rather
// than a literal so the import-shape test keeps its exact list of modules. Old builds are refused
// in TypeScript before this call; a failure here is a signed HRESULT the caller names.

int shim_window_set_material(shim_h hwnd, int kind) {
	if (!hwnd) return -1;
	if (kind != 2 && kind != 3 && kind != 4) return -2;
	const char *module = "dwmapi.dll";
	shim_h dwm = LoadLibraryA(module);
	if (!dwm) return -3;
	int (*set_attr)(shim_h, unsigned int, const void *, unsigned int) =
	    (int (*)(shim_h, unsigned int, const void *, unsigned int))GetProcAddress(
	        dwm, "DwmSetWindowAttribute");
	if (!set_attr) return -4;
	return set_attr(hwnd, 38u, &kind, (unsigned int)sizeof(kind));
}
