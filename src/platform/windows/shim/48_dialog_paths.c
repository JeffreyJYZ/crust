// --- the file panels: the answer buffers -----------------------------------
// Split from `48_dialog.c` at the line cap, and along the seam that matters: that part owns the
// types and the entry points, this one owns what a pick writes back. Everything here reads or writes
// the statics `48_dialog.c` declares, which is why the two are adjacent in the unit.

// UTF-16 in, UTF-8 out, in a caller-owned buffer. The only step here that can fail on a well-formed
// path is this one, so an empty answer is checked by the caller rather than trusted.
void shim_dialog_utf8(const shim_wchar *src, char *dst, int cap) {
	int n;
	if (!WideCharToMultiByte || !src || !dst || cap <= 0) return;
	dst[0] = 0;
	n = WideCharToMultiByte(65001u, 0u, src, -1, dst, cap, 0, 0);
	if (n <= 0) dst[0] = 0;
	else dst[n - 1 < cap ? n - 1 : cap - 1] = 0;
}

// The wide title, into the static buffer comdlg32 reads. An absent title stays absent so the panel
// shows its own default rather than an empty caption.
void shim_dialog_set_title(const char *title) {
	if (!title || !title[0]) return;
	shim_utf16(title, g_dlg_title, SHIM_DIALOG_TITLE_MAX);
}

// One answer into `g_dlg_paths`, from the buffer comdlg32 filled. A multi-select is
// `dir\0name\0name\0\0`; anything else is one complete path.
void shim_dialog_split(void) {
	int first = 0;
	int pos;
	int n = 0;
	g_dlg_count = 0;
	while (first < SHIM_DIALOG_NAME_MAX - 2 && g_dlg_names[first]) first++;
	if (g_dlg_names[first + 1] == 0) {
		shim_dialog_utf8(g_dlg_names, g_dlg_paths[0], SHIM_DIALOG_PATH);
		if (g_dlg_paths[0][0]) g_dlg_count = 1;
		return;
	}
	pos = first + 1;
	while (g_dlg_names[pos] && n < SHIM_DIALOG_MAX) {
		// `SHIM_DIALOG_PATH` code units, written out because `frame.test.ts` measures every local
		// array and a macro bound is unmeasurable: 1024 * 2 bytes is half the 4096-byte frame limit.
		shim_wchar full[1024];
		int w = 0;
		int d = 0;
		int k = 0;
		while (d < first && w < SHIM_DIALOG_PATH - 2) full[w++] = g_dlg_names[d++];
		if (w > 0 && full[w - 1] != '\\' && full[w - 1] != '/') full[w++] = '\\';
		while (g_dlg_names[pos + k] && w < SHIM_DIALOG_PATH - 1) full[w++] = g_dlg_names[pos + k++];
		full[w] = 0;
		shim_dialog_utf8(full, g_dlg_paths[n], SHIM_DIALOG_PATH);
		if (g_dlg_paths[n][0]) n++;
		pos += k + 1;
	}
	g_dlg_count = n;
}

// SHBrowseForFolderW, for `directory: true`. It returns a PIDL, never a path, so the path is read
// with SHGetPathFromIDListW and the PIDL released with CoTaskMemFree — its allocator, not `free`.
int shim_dialog_folder(const char *title, shim_h owner) {
	shim_browseinfo info;
	void *pidl;
	int i;
	if (!SHBrowseForFolderW || !SHGetPathFromIDListW || !CoTaskMemFree) return -2;
	for (i = 0; i < (int)sizeof(info); i++) ((char *)&info)[i] = 0;
	shim_dialog_set_title(title);
	info.hwndOwner = owner;
	info.pszDisplayName = g_dlg_names;
	info.lpszTitle = g_dlg_title[0] ? g_dlg_title : 0;
	// RETURNONLYFSDIRS | EDITBOX | NEWDIALOGSTYLE: filesystem folders only, with a typed path.
	info.ulFlags = 0x0001u | 0x0010u | 0x0040u;
	pidl = SHBrowseForFolderW(&info);
	if (!pidl) return 0;
	if (!SHGetPathFromIDListW(pidl, g_dlg_names)) {
		CoTaskMemFree(pidl);
		g_dlg_error = 1;
		return -3;
	}
	CoTaskMemFree(pidl);
	shim_dialog_utf8(g_dlg_names, g_dlg_paths[0], SHIM_DIALOG_PATH);
	g_dlg_count = g_dlg_paths[0][0] ? 1 : 0;
	return g_dlg_count > 0 ? 1 : -3;
}
