// --- the pointer table for the three namespaces every app reaches first -----
// clipboard, opener and `os.info`: the calls a normal app makes in its first hour. Split out of
// `10_prelude.c` when that file reached the line cap, and resolved exactly like everything there —
// `12_win32.c` binds each pointer, so nothing is linked and no import thunk exists to get wrong.
//
// Four modules, each named in the preflight table: user32 owns the clipboard, kernel32 owns the
// global heap a clipboard block must come from plus the two conversions and the locale, shell32 owns
// the association lookup `ShellExecuteW` performs, and ntdll owns the version call that keeps
// answering the truth without an application manifest.

// The clipboard. Every one of these returns BOOL except the two handle-returning calls, and a wrong
// width here reads an undefined top half of RAX rather than failing — `abi-width.test.ts` pins each.
static int (*OpenClipboard)(shim_h owner);
static int (*CloseClipboard)(void);
static int (*EmptyClipboard)(void);
static shim_h (*GetClipboardData)(unsigned int format);
static shim_h (*SetClipboardData)(unsigned int format, shim_h memory);

// The global heap a clipboard block must come from: `SetClipboardData` takes ownership of a
// `GMEM_MOVEABLE` block and frees it itself, so the memory cannot come from malloc.
static shim_h (*GlobalAlloc)(unsigned int flags, unsigned long long bytes);
static shim_h (*GlobalLock)(shim_h memory);
static int (*GlobalUnlock)(shim_h memory);
static shim_h (*GlobalFree)(shim_h memory);

// UTF-16 in, UTF-8 out. `MultiByteToWideChar` in the prelude is the other direction; the clipboard
// and the locale both need this one, because everything crossing bun:ffi is bytes.
static int (*WideCharToMultiByte)(unsigned int cp, unsigned int flags, const shim_wchar *src,
                                  int srclen, char *dst, int dstlen, const char *fallback,
                                  int *used);

// The shell's own association lookup — what a double-click does. `int` is not the return type here:
// ShellExecuteW answers an HINSTANCE, and a value at or below 32 is a SE_ERR_* code, not an HRESULT.
static shim_h (*ShellExecuteW)(shim_h window, const shim_wchar *verb, const shim_wchar *file,
                               const shim_wchar *params, const shim_wchar *dir, int show);

// `RtlGetVersion` is the only call that reports the real build: `GetVersionExW` answers 6.2 to a
// process with no compatibility manifest, which is every crust app. LONG is 32-bit NTSTATUS.
static int (*RtlGetVersion)(void *info);
// BCP-47, e.g. "en-GB", into a caller-sized UTF-16 buffer; 0 when Windows cannot answer.
static int (*GetUserDefaultLocaleName)(shim_wchar *name, int cap);
