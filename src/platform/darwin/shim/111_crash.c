// --- crash: the fault handler that outlives the crash -------------------------
// Compiled with 112_crash_install.c as one translation unit by platform/darwin/crash.ts, and never
// with the window shim: nothing here touches AppKit, and a fault handler must not share a unit with
// code that can be mid-send when the fault arrives.
//
// This is the one unit in the tree that is deliberately async-signal-unsafe-free: it allocates
// nothing, formats nothing, takes no lock, touches no stdio, no NSString and no Objective-C. It
// writes one fixed 84-byte record with write(2) and leaves with _exit(2). That is the whole point
// — a reporter living inside a crashed process cannot be trusted to finish anything that needs
// the runtime, so it must need nothing.
//
// The shim's four rules still hold: no header, no framework, no object and no struct across
// bun:ffi. The record is a fixed byte layout the TypeScript side reads with a DataView, so the
// kernel struct transcribed below never crosses the boundary.
//
// siginfo_t, transcribed from the macOS SDK because there is none at cc() time:
//   si_signo 0, si_errno 4, si_code 8, si_pid 12, si_uid 16, si_status 20, si_addr 24 (arm64)

extern long write(int, const void *, unsigned long);
extern void _exit(int);

#define CR_RECORD_BYTES 84
#define CR_HANDLER_BYTES 64
#define CR_HANDLER_AT 20

// 70 is the exit the guard reads as "the handler ran"; 71 is a handler that faulted on itself.
#define CR_EXIT_CRASH 70
#define CR_EXIT_REENTERED 71

typedef void (*cr_handler_t)(int, void *, void *);

typedef struct {
	int signo;
	int error;
	int code;
	int pid;
	unsigned int uid;
	int status;
	void *addr;
} cr_siginfo_t;

// int is sig_atomic_t on Darwin, and no header exists to name the type.
static volatile int cr_fd = -1;
static volatile int cr_inside = 0;
static unsigned char cr_record[CR_RECORD_BYTES];
static char cr_reason[160];

static void cr_reason_set(const char *text) {
	long i = 0;
	while (text[i] != 0 && i < 159) {
		cr_reason[i] = text[i];
		i++;
	}
	cr_reason[i] = 0;
}

const char *crust_crash_reason(void) { return cr_reason; }

int crust_crash_armed(void) { return cr_fd >= 0 ? 1 : 0; }

// Little-endian on purpose, written by hand: the reader states its byte order instead of inheriting
// the host's.
static void cr_put_i32(unsigned char *at, int value) {
	unsigned int v = (unsigned int)value;
	at[0] = (unsigned char)(v & 0xff);
	at[1] = (unsigned char)((v >> 8) & 0xff);
	at[2] = (unsigned char)((v >> 16) & 0xff);
	at[3] = (unsigned char)((v >> 24) & 0xff);
}

static void cr_put_u64(unsigned char *at, unsigned long value) {
	int i = 0;
	while (i < 8) {
		at[i] = (unsigned char)((value >> (i * 8)) & 0xff);
		i++;
	}
}

// The only function that runs after the fault. Everything it calls is async-signal-safe.
static void cr_emit(int sig, void *info, const char *name) {
	if (cr_inside != 0) _exit(CR_EXIT_REENTERED);
	cr_inside = 1;

	int fd = cr_fd;
	if (fd < 0) _exit(CR_EXIT_CRASH);

	int code = 0;
	unsigned long addr = 0;
	if (info != 0) {
		cr_siginfo_t *si = (cr_siginfo_t *)info;
		code = si->code;
		addr = (unsigned long)si->addr;
	}

	cr_record[0] = 'C';
	cr_record[1] = 'R';
	cr_record[2] = 'S';
	cr_record[3] = 'H';
	cr_put_i32(cr_record + 4, sig);
	cr_put_i32(cr_record + 8, code);
	cr_put_u64(cr_record + 12, addr);

	// The handler's own name, NUL-padded to the fixed field: no formatting, no allocation.
	long i = 0;
	int ended = 0;
	while (i < CR_HANDLER_BYTES) {
		char c = 0;
		if (ended == 0) {
			c = name[i];
			if (c == 0) ended = 1;
		}
		cr_record[CR_HANDLER_AT + i] = (unsigned char)c;
		i++;
	}

	long done = 0;
	while (done < CR_RECORD_BYTES) {
		long wrote = write(fd, cr_record + done, (unsigned long)(CR_RECORD_BYTES - done));
		if (wrote <= 0) break;
		done += wrote;
	}
	_exit(CR_EXIT_CRASH);
}

static void cr_on_segv(int sig, void *info, void *context) {
	(void)context;
	cr_emit(sig, info, "SIGSEGV");
}

static void cr_on_bus(int sig, void *info, void *context) {
	(void)context;
	cr_emit(sig, info, "SIGBUS");
}

static void cr_on_ill(int sig, void *info, void *context) {
	(void)context;
	cr_emit(sig, info, "SIGILL");
}

static void cr_on_fpe(int sig, void *info, void *context) {
	(void)context;
	cr_emit(sig, info, "SIGFPE");
}

static void cr_on_abrt(int sig, void *info, void *context) {
	(void)context;
	cr_emit(sig, info, "SIGABRT");
}
