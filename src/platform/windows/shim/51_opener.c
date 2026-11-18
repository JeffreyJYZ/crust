// --- opener ----------------------------------------------------------------
// ShellExecuteW with the "open" verb: the shell's own association lookup, which is what a
// double-click performs. A URL takes the same call — the shell resolves `https:` to the default
// browser — so `openUrl` and `openPath` differ only in what they hand over.
//
// **The return value is not an error code.** ShellExecuteW answers an HINSTANCE, and anything at or
// below 32 is a `SE_ERR_*` value (2 file not found, 5 access denied, 31 no association), so the
// number is recorded as a reason and never handed back as an HRESULT. Success is "greater than 32".
//
// revealItem is `explorer.exe /select,<path>`, the shell's own selection verb. The path is quoted
// inside the parameters because explorer parses that argument itself, and a directory with a space
// in its name is the normal case.

#define SHIM_SW_SHOWNORMAL 1
// A path is at most 32 767 UTF-16 units on Windows; one buffer per call site is enough because the
// shim is one thread and every call here is synchronous.
#define SHIM_OPENER_CHARS 0x8000

static shim_wchar g_opener_file[SHIM_OPENER_CHARS];
static shim_wchar g_opener_params[SHIM_OPENER_CHARS];
static char g_opener_reason[256];

// The two literals as code units, not `L"open"`/`L"explorer.exe"`: TinyCC has no Windows SDK here,
// and its wide literal type is not this unit's `shim_wchar` — passing one is an incompatible pointer
// (measured: `assignment from incompatible pointer type` at every call site).
static const shim_wchar SHIM_VERB_OPEN[] = {'o', 'p', 'e', 'n', 0};
static const shim_wchar SHIM_EXPLORER[] = {'e', 'x', 'p', 'l', 'o', 'r', 'e', 'r', '.', 'e',
                                           'x', 'e', 0};

// Bounded copy of a literal, always NUL-terminated: this buffer crosses bun:ffi as a cstring.
static void shim_opener_note(const char *text) {
	int i = 0;
	if (text) {
		while (text[i] && i < 250) {
			g_opener_reason[i] = text[i];
			i++;
		}
	}
	g_opener_reason[i] = 0;
}

// Why the last send ended as it did, naming the step that answered and the number it answered.
const char *shim_opener_reason_text(void) { return g_opener_reason; }

// One ShellExecuteW call, with the HINSTANCE/32 comparison the Win32 documentation asks for.
static int shim_opener_send(const shim_wchar *verb, const shim_wchar *file,
                            const shim_wchar *params) {
	if (!shim_win32_load() || !ShellExecuteW) {
		shim_opener_note("the Win32 entry points did not resolve, so ShellExecuteW was not called");
		return 0;
	}
	shim_h answer = ShellExecuteW(0, verb, file, params, 0, SHIM_SW_SHOWNORMAL);
	unsigned long long code = (unsigned long long)answer;
	if (code > 32) {
		shim_opener_note("");
		return 1;
	}
	// 0-32 is SE_ERR_*, and printing it as a hex HRESULT would be a wrong diagnosis.
	shim_opener_note("ShellExecuteW answered a SE_ERR_* code at or below 32, which is not an HRESULT");
	return 0;
}

// UTF-8 bytes into the shared wide buffer, NUL-terminated; the character count, or -1.
static int shim_opener_wide(const char *bytes, int length, shim_wchar *into, int cap) {
	if (!bytes || length < 0) return -1;
	// `shim_utf16` takes the NUL-terminated source and writes its own terminator.
	if (length + 1 > cap) {
		shim_opener_note("the path is longer than the shim's wide buffer");
		return -1;
	}
	return shim_utf16(bytes, into, cap);
}

// 1 handed to the shell, 0 refused with a reason.
int shim_opener_open_path(const char *bytes, int length) {
	if (shim_opener_wide(bytes, length, g_opener_file, SHIM_OPENER_CHARS) < 0) return 0;
	return shim_opener_send(SHIM_VERB_OPEN, g_opener_file, 0);
}

// 1 handed to the shell, 0 refused with a reason. The URL is not validated here: the plugin's own
// `SCHEME` test refuses a string with no scheme before this is reached.
int shim_opener_open_url(const char *bytes, int length) {
	if (shim_opener_wide(bytes, length, g_opener_file, SHIM_OPENER_CHARS) < 0) return 0;
	return shim_opener_send(SHIM_VERB_OPEN, g_opener_file, 0);
}

// `explorer.exe /select,"<path>"`: the shell's own "select this item" verb.
int shim_opener_reveal(const char *bytes, int length) {
	if (shim_opener_wide(bytes, length, g_opener_file, SHIM_OPENER_CHARS) < 0) return 0;
	int i = 0;
	const char *prefix = "/select,\"";
	for (int p = 0; prefix[p] && i < SHIM_OPENER_CHARS - 3; p++) g_opener_params[i++] = (shim_wchar)prefix[p];
	int f = 0;
	while (g_opener_file[f] && i < SHIM_OPENER_CHARS - 2) g_opener_params[i++] = g_opener_file[f++];
	g_opener_params[i++] = (shim_wchar)'"';
	g_opener_params[i] = 0;
	return shim_opener_send(SHIM_VERB_OPEN, SHIM_EXPLORER, g_opener_params);
}
