// --- crash: arming and disarming the handlers --------------------------------
// The second half of the crash unit, compiled with 111_crash.c as one translation unit by
// platform/darwin/crash.ts. It shares that file's statics (the record descriptor, the reason buffer
// and the five handlers), so the join order matters: this text must come second.
//
// Transcribed from the macOS SDK, because there is no SDK at cc() time:
//   struct sigaction { union { handler } 0, sigset_t 8, int sa_flags 12 } — 16 bytes, because
//                    Darwin's sigset_t is __uint32_t
//   SIGILL 4, SIGABRT 6, SIGFPE 8, SIGBUS 10, SIGSEGV 11
//   SA_NODEFER 0x0010, SA_SIGINFO 0x0040
//   O_WRONLY 0x0001, O_CREAT 0x0200, O_TRUNC 0x0400

// Variadic, exactly as libSystem declares it: with a fixed three-argument prototype TinyCC drops the
// mode, and the record lands 0000 — unreadable by the guard, which is how that was found.
extern int open(const char *, int, ...);
extern int close(int);
extern int sigaction(int, const void *, void *);

#define CR_PATH_BYTES 1024

#define CR_SIGILL 4
#define CR_SIGABRT 6
#define CR_SIGFPE 8
#define CR_SIGBUS 10
#define CR_SIGSEGV 11

#define CR_SA_NODEFER 0x0010
#define CR_SA_SIGINFO 0x0040

#define CR_O_WRONLY 0x0001
#define CR_O_CREAT 0x0200
#define CR_O_TRUNC 0x0400
#define CR_MODE 0600

typedef struct {
	cr_handler_t handler;
	unsigned int mask;
	int flags;
} cr_action_t;

// NODEFER so a fault inside the handler re-enters instead of hanging, and the flag in 111_crash.c is
// what makes that second entry leave immediately.
static int cr_install(int sig, cr_handler_t fn) {
	cr_action_t action;
	action.handler = fn;
	action.mask = 0;
	action.flags = CR_SA_SIGINFO | CR_SA_NODEFER;
	return sigaction(sig, &action, 0);
}

// 0 armed, 1 already armed, 2 the record path was refused, 3 sigaction was refused.
int crust_crash_arm(const char *bytes, long len) {
	if (cr_fd >= 0) {
		cr_reason_set("already armed: a record descriptor is open");
		return 1;
	}
	if (bytes == 0 || len <= 0 || len >= CR_PATH_BYTES) {
		cr_reason_set("the record path must be 1..1023 bytes");
		return 2;
	}
	char path[CR_PATH_BYTES];
	long i = 0;
	while (i < len) {
		path[i] = bytes[i];
		i++;
	}
	path[len] = 0;
	int fd = open(path, CR_O_WRONLY | CR_O_CREAT | CR_O_TRUNC, CR_MODE);
	if (fd < 0) {
		cr_reason_set("open(2) refused the record path");
		return 2;
	}
	if (cr_install(CR_SIGSEGV, cr_on_segv) != 0 || cr_install(CR_SIGBUS, cr_on_bus) != 0 ||
	    cr_install(CR_SIGILL, cr_on_ill) != 0 || cr_install(CR_SIGFPE, cr_on_fpe) != 0 ||
	    cr_install(CR_SIGABRT, cr_on_abrt) != 0) {
		close(fd);
		cr_reason_set("sigaction refused a handler");
		return 3;
	}
	cr_fd = fd;
	cr_reason_set("armed");
	return 0;
}

int crust_crash_disarm(void) {
	cr_install(CR_SIGSEGV, (cr_handler_t)0);
	cr_install(CR_SIGBUS, (cr_handler_t)0);
	cr_install(CR_SIGILL, (cr_handler_t)0);
	cr_install(CR_SIGFPE, (cr_handler_t)0);
	cr_install(CR_SIGABRT, (cr_handler_t)0);
	int fd = cr_fd;
	cr_fd = -1;
	if (fd >= 0) close(fd);
	cr_reason_set("disarmed");
	return 0;
}
