// --- the file panels: the two calls ----------------------------------------
// One call per panel, each returning a status the adapter maps without guessing:
//   1  picked — read `shim_dialog_count`/`shim_dialog_path`
//   0  the human cancelled — an ordinary answer, never an error
//  -2  comdlg32 or shell32 did not resolve — `shim_dialog_missing` names what is absent
//  -3  the API refused with a code — `shim_dialog_error` holds CommDlgExtendedError
// `CommDlgExtendedError` is the difference between a cancel and a real failure: comdlg32 answers 0
// from both, and only the extended error separates "the human said no" from "the buffer was too
// small". Reading a cancel as a failure (or the reverse) is the fake-success this layer refuses.

#define SHIM_OFN_EXPLORER 0x00080000u
#define SHIM_OFN_FILEMUSTEXIST 0x00001000u
#define SHIM_OFN_PATHMUSTEXIST 0x00000800u
#define SHIM_OFN_NOCHANGEDIR 0x00000008u
#define SHIM_OFN_HIDEREADONLY 0x00000004u
#define SHIM_OFN_ALLOWMULTISELECT 0x00000200u
#define SHIM_OFN_OVERWRITEPROMPT 0x00000002u

// A fresh struct per call: `lStructSize` is the first field comdlg32 reads, and every other field
// starts at zero so an unset one is the API's default rather than the previous pick's value.
static void shim_dialog_ofn_init(shim_openfilename *ofn) {
	int i;
	for (i = 0; i < (int)sizeof(*ofn); i++) ((char *)ofn)[i] = 0;
	ofn->lStructSize = (unsigned int)sizeof(shim_openfilename);
	ofn->lpstrFile = g_dlg_names;
	ofn->nMaxFile = SHIM_DIALOG_NAME_MAX;
	ofn->nFilterIndex = 1;
	if (g_dlg_filter[0]) ofn->lpstrFilter = g_dlg_filter;
	if (g_dlg_title[0]) ofn->lpstrTitle = g_dlg_title;
}

// The status both calls answer with, so the mapping lives in one place.
static int shim_dialog_answer(int accepted) {
	unsigned int why;
	if (accepted) {
		shim_dialog_split();
		return g_dlg_count > 0 ? 1 : -3;
	}
	why = CommDlgExtendedError ? CommDlgExtendedError() : 0;
	g_dlg_error = why;
	return why ? -3 : 0;
}

int shim_dialog_open(const char *title, const char *filters, int multiple, int directory,
                     shim_h owner) {
	shim_openfilename ofn;
	shim_dialog_reset();
	if (!shim_dialog_resolve()) return -2;
	if (directory) return shim_dialog_folder(title, owner);
	shim_dialog_filters(filters);
	shim_dialog_set_title(title);
	shim_dialog_ofn_init(&ofn);
	ofn.hwndOwner = owner;
	ofn.Flags = SHIM_OFN_EXPLORER | SHIM_OFN_FILEMUSTEXIST | SHIM_OFN_PATHMUSTEXIST |
	            SHIM_OFN_NOCHANGEDIR | SHIM_OFN_HIDEREADONLY;
	if (multiple) ofn.Flags |= SHIM_OFN_ALLOWMULTISELECT;
	return shim_dialog_answer(GetOpenFileNameW(&ofn));
}

// The save panel. OVERWRITEPROMPT is the "replace this file?" question, which is comdlg32's own and
// is never asked twice by a caller; FILEMUSTEXIST is deliberately absent, because a save creates.
int shim_dialog_save(const char *title, const char *suggested, const char *filters, shim_h owner) {
	shim_openfilename ofn;
	shim_dialog_reset();
	if (!shim_dialog_resolve()) return -2;
	shim_dialog_filters(filters);
	shim_dialog_set_title(title);
	if (suggested && suggested[0]) shim_utf16(suggested, g_dlg_names, SHIM_DIALOG_NAME_MAX);
	shim_dialog_ofn_init(&ofn);
	ofn.hwndOwner = owner;
	ofn.Flags = SHIM_OFN_EXPLORER | SHIM_OFN_OVERWRITEPROMPT | SHIM_OFN_PATHMUSTEXIST |
	            SHIM_OFN_NOCHANGEDIR | SHIM_OFN_HIDEREADONLY;
	return shim_dialog_answer(GetSaveFileNameW(&ofn));
}

// How many paths the last pick answered with; 0 after a cancel, and never more than SHIM_DIALOG_MAX.
int shim_dialog_count(void) { return g_dlg_count; }

// One path from the last pick, as UTF-8. An index outside the answer is an empty string rather than
// a read past the array — the adapter checks the count first and treats an empty path as malformed.
const char *shim_dialog_path(int index) {
	if (index < 0 || index >= g_dlg_count) return "";
	return g_dlg_paths[index];
}

// CommDlgExtendedError from the last refused call, or 0. Only meaningful after a -3.
unsigned int shim_dialog_error(void) { return g_dlg_error; }
