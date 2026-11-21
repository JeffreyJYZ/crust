// --- the file panels: types, entry points and the filter buffer -------------
// comdlg32's GetOpenFileNameW/GetSaveFileNameW for files, shell32's SHBrowseForFolderW for a folder.
// COM's IFileOpenDialog would carry FOS_PICKFOLDERS in one API, but it needs CoCreateInstance, three
// interface vtables and an IShellItem-to-path step — four more layouts to get wrong in a unit that
// cannot be run on this machine — and it is modal in exactly the same way.
//
// EVERY ONE OF THESE IS MODAL ON THE CALLING THREAD, and that is the safe half of the choice. This
// runs on Bun's main thread: the thread that owns the HWND and the thread COM was initialised on, so
// the panel is modal to the thread that owns the window and cannot deadlock against a pump on
// another one. What it does cost is JavaScript: the dialog runs its own message loop, so the window
// keeps painting, but no timer and no in-flight invoke runs until the human answers. There is no
// non-blocking Win32 file picker to offer instead, and a pick on a worker thread would be the
// wrong-thread modal this comment exists to rule out.
//
// Resolved separately from `shim_win32_load`: comdlg32 and shell32 are only needed by a pick, so a
// machine missing one must still launch an app and refuse this namespace by name.

// OPENFILENAMEW, field for field. `lStructSize` is what comdlg32 reads first, so the struct is
// declared rather than approximated: x64 pads each pointer to 8 and the whole thing is 152 bytes.
typedef struct {
	unsigned int lStructSize;
	shim_h hwndOwner;
	shim_h hInstance;
	const shim_wchar *lpstrFilter;
	shim_wchar *lpstrCustomFilter;
	unsigned int nMaxCustFilter;
	unsigned int nFilterIndex;
	shim_wchar *lpstrFile;
	unsigned int nMaxFile;
	shim_wchar *lpstrFileTitle;
	unsigned int nMaxFileTitle;
	const shim_wchar *lpstrInitialDir;
	const shim_wchar *lpstrTitle;
	unsigned int Flags;
	unsigned short nFileOffset;
	unsigned short nFileExtension;
	const shim_wchar *lpstrDefExt;
	shim_i64 lCustData;
	void *lpfnHook;
	const shim_wchar *lpTemplateName;
	void *pvReserved;
	unsigned int dwReserved;
	unsigned int FlagsEx;
} shim_openfilename;

// BROWSEINFOW, for the folder picker. 64 bytes on x64 by the same rules.
typedef struct {
	shim_h hwndOwner;
	const void *pidlRoot;
	shim_wchar *pszDisplayName;
	const shim_wchar *lpszTitle;
	unsigned int ulFlags;
	void *lpfn;
	shim_i64 lParam;
	int iImage;
} shim_browseinfo;

#define SHIM_DIALOG_MAX 16
#define SHIM_DIALOG_PATH 1024
#define SHIM_DIALOG_NAME_MAX 32768
#define SHIM_DIALOG_FILTER_MAX 2048
#define SHIM_DIALOG_TITLE_MAX 512

// The name buffer comdlg32 writes into: one path, or `dir\0name\0name\0\0` for a multi-select.
static shim_wchar g_dlg_names[SHIM_DIALOG_NAME_MAX];
// The filter as comdlg32 wants it: `Name\0*.txt;*.md\0Name\0*.png\0\0`.
static shim_wchar g_dlg_filter[SHIM_DIALOG_FILTER_MAX];
static shim_wchar g_dlg_title[SHIM_DIALOG_TITLE_MAX];
// UTF-8 answers, so no UTF-16 pointer ever crosses bun:ffi.
static char g_dlg_paths[SHIM_DIALOG_MAX][SHIM_DIALOG_PATH];
static int g_dlg_count;
static unsigned int g_dlg_error;

static int (*GetOpenFileNameW)(shim_openfilename *);
static int (*GetSaveFileNameW)(shim_openfilename *);
static unsigned int (*CommDlgExtendedError)(void);
static void *(*SHBrowseForFolderW)(shim_browseinfo *);
static int (*SHGetPathFromIDListW)(const void *, shim_wchar *);
static void (*CoTaskMemFree)(void *);
// `WideCharToMultiByte` is declared by the shared pointer part (`11_pointer_core.c`) and bound with
// the rest of kernel32; declaring a second pointer here would be a second bind of one entry point.

static shim_h g_comdlg32;
static shim_h g_shell32;
// 0 = not tried, 1 = ready, -1 = a module or an entry point was missing.
static int g_dlg_state;

int shim_dialog_resolve(void) {
	if (g_dlg_state) return g_dlg_state > 0;
	g_dlg_state = -1;
	if (!shim_win32_load()) return 0;
	g_comdlg32 = LoadLibraryA("comdlg32.dll");
	if (!g_comdlg32) return 0;
	SHIM_BIND(g_comdlg32, GetOpenFileNameW);
	SHIM_BIND(g_comdlg32, GetSaveFileNameW);
	SHIM_BIND(g_comdlg32, CommDlgExtendedError);
	g_shell32 = LoadLibraryA("shell32.dll");
	if (!g_shell32) return 0;
	SHIM_BIND(g_shell32, SHBrowseForFolderW);
	SHIM_BIND(g_shell32, SHGetPathFromIDListW);
	// Already-loaded modules: kernel32 is in the process and ole32 was bound by `shim_win32_load`.
	// `WideCharToMultiByte` is bound with the rest of kernel32, so only the PIDL free is new here.
	SHIM_BIND(g_ole32, CoTaskMemFree);
	g_dlg_state = 1;
	return 1;
}

// The entry point that did not resolve, for a refusal that names it instead of failing silently.
const char *shim_dialog_missing(void) {
	if (shim_dialog_resolve()) return "";
	if (!g_comdlg32) return "comdlg32.dll";
	if (!g_shell32) return "shell32.dll";
	return "a comdlg32 or shell32 entry point";
}

// Clear every buffer a pick writes into. comdlg32 appends to `lpstrFile` rather than replacing it, so
// a stale path from the previous pick would be read as this one's answer.
void shim_dialog_reset(void) {
	int i;
	g_dlg_count = 0;
	g_dlg_error = 0;
	// Zero the whole name buffer, not just its first unit. `shim_dialog_split` decides single vs
	// multi-select by the double NUL after the returned path; comdlg32 writes the new path and its
	// NUL but leaves the tail of a longer previous pick intact, which used to make a short second
	// pick look like a multi-select built from new directory + old filenames.
	for (i = 0; i < SHIM_DIALOG_NAME_MAX; i++) g_dlg_names[i] = 0;
	g_dlg_filter[0] = 0;
	g_dlg_title[0] = 0;
	for (i = 0; i < SHIM_DIALOG_MAX; i++) g_dlg_paths[i][0] = 0;
}

// `Name|*.txt;*.md\nImages|*.png` -> the NUL-separated wide form, double-terminated. A group with no
// patterns contributes nothing, because an empty pattern is a filter that matches everything — the
// fake this layer must not ship.
void shim_dialog_filters(const char *src) {
	int i = 0;
	int n = 0;
	if (!src || !src[0]) return;
	while (src[i] && n < SHIM_DIALOG_FILTER_MAX - 4) {
		char field[512];
		int f = 0;
		int written;
		while (src[i] && src[i] != '|' && src[i] != '\n' && f < 500) field[f++] = src[i++];
		field[f] = 0;
		if (src[i] == '|') i++;
		else if (src[i] == '\n') {
			i++;
			continue;
		}
		if (f == 0) continue;
		written = shim_utf16(field, &g_dlg_filter[n], SHIM_DIALOG_FILTER_MAX - n - 2);
		if (written <= 0) return;
		n += written + 1;
		// The pattern field is required: a name with no pattern is not a filter.
		f = 0;
		while (src[i] && src[i] != '\n' && f < 500) field[f++] = src[i++];
		field[f] = 0;
		if (src[i] == '\n') i++;
		if (f == 0) continue;
		written = shim_utf16(field, &g_dlg_filter[n], SHIM_DIALOG_FILTER_MAX - n - 2);
		if (written <= 0) return;
		n += written + 1;
	}
	// The list ends with an empty string, which is a second NUL after the last field's own.
	g_dlg_filter[n] = 0;
}
