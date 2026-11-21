// --- `crust:pty` on Windows: the reason strings and the bind table ----------
// Second part of the ConPTY unit, in the same translation unit as `63_pty.c`: it writes the same
// statics 63 declares, then resolves every kernel32 entry point 63 and 66 call.
//
// The reason is one line, always: a refused call names itself and its `GetLastError`, so the plugin
// can hand the page a message rather than a number, and a machine missing an export names the
// export instead of failing at address zero on the first call.
static char *shim_pty_text(char *at, const char *text) {
	while (*text) *at++ = *text++;
	return at;
}

static char *shim_pty_number(char *at, unsigned long long value) {
	char digits[24];
	int count = 0;
	if (value == 0) {
		*at++ = '0';
		return at;
	}
	while (value) {
		digits[count++] = (char)('0' + (value % 10));
		value /= 10;
	}
	while (count) *at++ = digits[--count];
	return at;
}

// One line, so the adapter can say why without a second call.
static void shim_pty_fail(const char *what, unsigned int code) {
	char *at = shim_pty_text(g_pty_reason, what);
	if (code) {
		at = shim_pty_text(at, " (GetLastError ");
		at = shim_pty_number(at, code);
		at = shim_pty_text(at, ")");
	}
	*at = 0;
}

static void shim_pty_zero(void *p, shim_u64 bytes) {
	unsigned char *b = (unsigned char *)p;
	while (bytes--) *b++ = 0;
}

const char *shim_pty_missing(void) { return g_pty_missing; }
const char *shim_pty_reason(void) { return g_pty_reason; }
int shim_pty_last_error(void) { return GetLastError ? (int)GetLastError() : 0; }

// UTF-8 in, UTF-16 out, NUL-terminated. Answers the UTF-16 length written, or -1.
static int shim_pty_wide(const char *src, shim_wchar *dst, int cap) {
	if (!src || !dst || cap <= 0 || !MultiByteToWideChar) return -1;
	int n = (int)MultiByteToWideChar(65001u, 0u, src, -1, dst, cap);
	if (n <= 0) return -1;
	dst[n - 1] = 0;
	return n - 1;
}

// `__typeof__` keeps each pointer's exact prototype, so no cast is written twice — the one GNU
// extension in this unit, the same one `12_win32.c` uses.
#define SHIM_BIND(module, name)                           \
	do {                                                  \
		void *shim_symbol = GetProcAddress(module, #name); \
		if (!shim_symbol) {                               \
			int i = 0;                                    \
			const char *text = #name;                     \
			while (text[i] && i < 63) {                   \
				g_pty_missing[i] = text[i];               \
				i++;                                      \
			}                                             \
			g_pty_missing[i] = 0;                         \
			return 0;                                     \
		}                                                 \
		name = (__typeof__(name))shim_symbol;             \
	} while (0)

// The reader thread `64_pty_io.c` defines; forward-declared so `open` can start it.
unsigned long shim_pty_reader(void *arg);

// 1 when every entry point resolved, 0 when one did not — named by `shim_pty_missing`. Asked
// before any other call, because a null pointer here is a call to address zero, not a bad return.
int shim_pty_load(void) {
	if (g_pty_state) return g_pty_state > 0;
	g_pty_state = -1;
	shim_h kernel32 = LoadLibraryA("kernel32.dll");
	if (!kernel32) {
		shim_pty_fail("LoadLibraryA(kernel32.dll) answered NULL", GetLastError ? GetLastError() : 0);
		return 0;
	}
	SHIM_BIND(kernel32, MultiByteToWideChar);
	SHIM_BIND(kernel32, GetLastError);
	SHIM_BIND(kernel32, CreatePipe);
	SHIM_BIND(kernel32, CloseHandle);
	SHIM_BIND(kernel32, CreatePseudoConsole);
	SHIM_BIND(kernel32, ResizePseudoConsole);
	SHIM_BIND(kernel32, ClosePseudoConsole);
	SHIM_BIND(kernel32, CreateProcessW);
	SHIM_BIND(kernel32, InitializeProcThreadAttributeList);
	SHIM_BIND(kernel32, UpdateProcThreadAttribute);
	SHIM_BIND(kernel32, DeleteProcThreadAttributeList);
	SHIM_BIND(kernel32, GetProcessHeap);
	SHIM_BIND(kernel32, HeapAlloc);
	SHIM_BIND(kernel32, HeapFree);
	SHIM_BIND(kernel32, WaitForSingleObject);
	SHIM_BIND(kernel32, GetExitCodeProcess);
	SHIM_BIND(kernel32, TerminateProcess);
	SHIM_BIND(kernel32, CreateThread);
	SHIM_BIND(kernel32, ReadFile);
	SHIM_BIND(kernel32, WriteFile);
	SHIM_BIND(kernel32, InitializeCriticalSection);
	SHIM_BIND(kernel32, EnterCriticalSection);
	SHIM_BIND(kernel32, LeaveCriticalSection);
	SHIM_BIND(kernel32, DeleteCriticalSection);
	g_pty_state = 1;
	return 1;
}

int shim_pty_ready(void) { return shim_pty_load(); }
