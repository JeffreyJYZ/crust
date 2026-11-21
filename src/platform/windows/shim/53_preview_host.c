// --- the preview host's surface: a child window and a handler CLSID --------
// Two lookups `54_preview.c` needs before COM is involved, kept apart from the show/size/hide
// lifecycle so neither file carries both responsibilities:
//
//   the child HWND  — its own class, with `DefWindowProcW` as the procedure. Nothing here paints: the
//                     handler owns every pixel of the rectangle it is given.
//   the CLSID       — the shell's association database, asked for the file's extension. Its absent
//                     answer is `no-handler`, the ordinary case for a file type Windows does not
//                     preview, and it is resolved *without* the file being opened or read.
//
// `shlwapi` is loaded here rather than in `12_win32.c` because only this surface needs it, and the
// binder answers 1 only when every entry point the sequence uses resolved: a machine missing one is a
// named refusal at `preview`, never a null call at the first window.
#define SHIM_PREVIEW_ASSOCF 0x400u /* ASSOCF_INIT_IGNOREUNKNOWN */
#define SHIM_PREVIEW_ASSOCSTR 16u  /* ASSOCSTR_SHELLEXTENSION */
// WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN: a child of the app window, on screen, and never painted
// over its own children — which is where the handler's real window lives.
#define SHIM_PREVIEW_CHILD 0x52000000u
#define SHIM_PREVIEW_CLASS_MAX 16

static shim_h g_shlwapi;
static int g_preview_state;
static int g_preview_class;

int shim_preview_ready(void) {
	if (g_preview_state) return g_preview_state > 0;
	g_preview_state = -1;
	if (!shim_win32_load() || !g_ole32 || !g_shell32) return 0;
	g_shlwapi = LoadLibraryA("shlwapi.dll");
	if (!g_shlwapi) return 0;
	SHIM_BIND(g_ole32, CoCreateInstance);
	SHIM_BIND(g_ole32, CLSIDFromString);
	SHIM_BIND(g_shlwapi, AssocQueryStringW);
	SHIM_BIND(g_shlwapi, SHCreateStreamOnFileEx);
	SHIM_BIND(g_shell32, SHCreateItemFromParsingName);
	g_preview_state = 1;
	return 1;
}

static const shim_wchar SHIM_PREVIEW_CLASS[SHIM_PREVIEW_CLASS_MAX] = {
    'c', 'r', 'u', 's', 't', '-', 'p', 'r', 'e', 'v', 'i', 'e', 'w', 0,
};

static shim_h preview_host(shim_h parent, int x, int y, int w, int h) {
	shim_wndclassex wc;
	if (!g_preview_class) {
		wc.cbSize = sizeof(wc);
		wc.style = 0x0001u | 0x0002u; /* CS_VREDRAW | CS_HREDRAW */
		wc.wndproc = DefWindowProcW;
		wc.clsExtra = 0;
		wc.wndExtra = 0;
		wc.instance = GetModuleHandleW(0);
		wc.icon = 0;
		wc.cursor = 0;
		wc.background = 0;
		wc.menu = 0;
		wc.cls = SHIM_PREVIEW_CLASS;
		wc.iconSm = 0;
		// A duplicate registration answers 0 with ERROR_CLASS_ALREADY_EXISTS and the window is still
		// created against the first atom, so this answer is not checked — `CreateWindowExW` is.
		RegisterClassExW(&wc);
		g_preview_class = 1;
	}
	return CreateWindowExW(0u, SHIM_PREVIEW_CLASS, 0, SHIM_PREVIEW_CHILD, x, y, w, h, parent, 0,
	                       GetModuleHandleW(0), 0);
}

// The handler CLSID registered for this file's extension: 1 resolved into `clsid`, 0 when nothing is
// registered for the type. The extension is found after the last path separator, so a folder name
// with a dot in it does not become the extension.
static int preview_resolve(const shim_wchar *path, unsigned char *clsid) {
	shim_wchar ext[96];
	shim_wchar text[80];
	unsigned int length = 80;
	int dot = -1;
	int i = 0;
	int n = 0;
	if (!path || !clsid) return 0;
	while (path[i]) {
		if (path[i] == '\\' || path[i] == '/') dot = -1;
		else if (path[i] == '.') dot = i;
		i++;
	}
	if (dot < 0) return 0;
	for (i = dot; path[i] && n < 95; i++) ext[n++] = path[i];
	ext[n] = 0;
	if (AssocQueryStringW(SHIM_PREVIEW_ASSOCF, SHIM_PREVIEW_ASSOCSTR, ext, SHIM_PREVIEW_CATEGORY,
	                      text, &length) < 0)
		return 0;
	return CLSIDFromString && CLSIDFromString(text, clsid) >= 0;
}
