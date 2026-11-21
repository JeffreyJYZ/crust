// --- `crust:pty` on Windows: the ConPTY contract ----------------------------
// Its own compilation unit, compiled by `pty-ffi.ts`, for the reason the notification unit is:
// it shares nothing with the window shim, so no lane's `shim-source.ts`, `ffi.ts`, `backend.ts` or
// `PREFLIGHT` table changes when this file does. Three parts follow, in the only order that
// compiles: `64_pty_bind.c` resolves the entry points and loads them, `65_pty_open.c` opens a
// console and its shell, `66_pty_io.c` is the reader thread and the calls a page makes. They share
// this file's statics and slot struct, so the split is by responsibility, not by coupling.
//
// No headers: every kernel32 entry point is a hand-written prototype resolved at runtime, exactly
// like `12_win32.c`, because `cc()` links nothing and TinyCC's PE import thunk jumped to
// 0xFFFFFFFFFFFFFFFF on Windows x64. Nothing but ints and NUL-terminated strings crosses bun:ffi:
// `STARTUPINFOEXW`, `COORD` and `PROCESS_INFORMATION` are built on this stack.

typedef void *shim_h;
typedef unsigned short shim_wchar;
typedef unsigned long long shim_u64;
typedef long long shim_i64;

// `SECURITY_ATTRIBUTES`, 24 bytes on x64. The pipe pairs carry `bInheritHandle = 1` because
// `CreatePseudoConsole` hands them to the console host process, which inherits them: with the
// default non-inheritable handles the console is created and the shell runs, yet its output never
// reaches the pipe this side reads (measured on windows-latest 2026-11-21 — pid alive, zero bytes).
typedef struct {
	unsigned int nLength;
	void *lpSecurityDescriptor;
	int bInheritHandle;
} shim_pty_security;

// The only two imports in the unit, and both are kernel32 — the two that do the resolving.
extern shim_h LoadLibraryA(const char *name);
extern void *GetProcAddress(shim_h module, const char *name);

// `COORD`: two shorts, x then y. Both console calls take it **by value**, not by pointer — passing
// a pointer reads the low 32 bits of an address as the size, which CreatePseudoConsole tolerates
// and ResizePseudoConsole refuses with E_INVALIDARG (measured on windows-latest 2026-11-21).
typedef struct {
	short x;
	short y;
} shim_pty_coord;

static unsigned int (*MultiByteToWideChar)(unsigned int cp, unsigned int flags, const char *src,
                                           int srclen, shim_wchar *dst, int dstlen);
static unsigned int (*GetLastError)(void);
static int (*CreatePipe)(void *read, void *write, void *attrs, unsigned int size);
static int (*CloseHandle)(shim_h handle);
static int (*CreatePseudoConsole)(shim_pty_coord size, shim_h input, shim_h output,
                                  unsigned int flags, void **console);
static int (*ResizePseudoConsole)(void *console, shim_pty_coord size);
static void (*ClosePseudoConsole)(void *console);
static int (*CreateProcessW)(const shim_wchar *image, shim_wchar *cmdline, void *procAttrs,
                             void *threadAttrs, int inherit, unsigned int flags, void *env,
                             const shim_wchar *cwd, void *startup, void *info);
static int (*InitializeProcThreadAttributeList)(void *list, unsigned int count, unsigned int flags,
                                                shim_u64 *bytes);
static int (*UpdateProcThreadAttribute)(void *list, unsigned int flags, shim_u64 attribute,
                                        void *value, shim_u64 size, void *previous,
                                        shim_u64 *returned);
static void (*DeleteProcThreadAttributeList)(void *list);
static shim_h (*GetProcessHeap)(void);
static void *(*HeapAlloc)(shim_h heap, unsigned int flags, shim_u64 bytes);
static int (*HeapFree)(shim_h heap, unsigned int flags, void *memory);
static unsigned int (*WaitForSingleObject)(shim_h handle, unsigned int ms);
static int (*GetExitCodeProcess)(shim_h process, unsigned int *code);
static int (*TerminateProcess)(shim_h process, unsigned int code);
// `64_pty_io.c`: the reader thread and the calls the page makes.
static shim_h (*CreateThread)(void *attrs, shim_u64 stack, void *start, void *param,
                              unsigned int flags, unsigned int *id);
static int (*ReadFile)(shim_h file, void *buffer, unsigned int want, unsigned int *got,
                       void *overlapped);
static int (*WriteFile)(shim_h file, const void *buffer, unsigned int want, unsigned int *wrote,
                        void *overlapped);
static void (*InitializeCriticalSection)(void *lock);
static void (*EnterCriticalSection)(void *lock);
static void (*LeaveCriticalSection)(void *lock);
static void (*DeleteCriticalSection)(void *lock);

// `STARTUPINFOW` (104 bytes on x64) plus the attribute-list pointer `EXTENDED_STARTUPINFO_PRESENT`
// adds: 112 bytes. The layout is the ABI, and `pty-abi.test.ts` measures every offset against a
// real compiler, because a struct that packs differently fails silently — `cb` is validated, then
// the console attribute is read from where Windows thinks the pointer is.
typedef struct {
	unsigned int cb;
	shim_wchar *lpReserved;
	shim_wchar *lpDesktop;
	shim_wchar *lpTitle;
	unsigned int dwX;
	unsigned int dwY;
	unsigned int dwXSize;
	unsigned int dwYSize;
	unsigned int dwXCountChars;
	unsigned int dwYCountChars;
	unsigned int dwFillAttribute;
	unsigned int dwFlags;
	unsigned short wShowWindow;
	unsigned short cbReserved2;
	unsigned char *lpReserved2;
	shim_h hStdInput;
	shim_h hStdOutput;
	shim_h hStdError;
	shim_h lpAttributeList;
} shim_pty_startup;

// `PROCESS_INFORMATION`: 24 bytes on x64.
typedef struct {
	shim_h process;
	shim_h thread;
	unsigned int pid;
	unsigned int tid;
} shim_pty_info;

// `CRITICAL_SECTION` is 40 bytes on x64. Padded rather than typed, because its members are internal.
typedef struct {
	shim_u64 pad[5];
} shim_pty_lock;

#define SHIM_PTY_MAX 4
#define SHIM_PTY_RING 65536
// `PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE`: 22, the INPUT bit of `ProcThreadAttributeValue(22, …)`.
#define SHIM_PTY_ATTRIBUTE 0x00020016ULL
// `EXTENDED_STARTUPINFO_PRESENT`, which is what makes `lpAttributeList` read at all.
#define SHIM_PTY_EXTENDED 0x00080000u
// `CREATE_UNICODE_ENVIRONMENT`: without it CreateProcessW reads the UTF-16 block as ANSI and fails
// with ERROR_INVALID_PARAMETER (87) — measured on windows-latest 2026-11-21.
#define SHIM_PTY_UNICODE_ENV 0x00000400u
// `STARTF_USESTDHANDLES` with all three handles `INVALID_HANDLE_VALUE` is the documented ConPTY
// way to give the child the console's std handles. Without it the child inherits Bun's stdout and
// writes to the runner's log instead of the pseudo-console (measured 2026-11-21).
#define SHIM_PTY_USESTD 0x00000100u
#define SHIM_PTY_NO_HANDLE ((void *)-1)
#define SHIM_PTY_WAIT_OBJECT 0u

typedef struct {
	void *console;
	shim_h process;
	shim_h thread;
	shim_h input;  // the write end the console reads
	shim_h output; // the read end this side reads
	shim_h reader;
	unsigned int pid;
	int used;
	int closed;
	int finished;
	unsigned int exit_code;
	int head;
	int tail;
	unsigned int total; // every byte the reader has pushed, for a probe that needs the number
	unsigned char ring[SHIM_PTY_RING];
	shim_pty_lock lock;
} shim_pty_slot;

static shim_pty_slot g_pty[SHIM_PTY_MAX];
static char g_pty_missing[64];
static char g_pty_reason[256];
static int g_pty_state; // 0 untried, 1 ready, -1 an export was missing
