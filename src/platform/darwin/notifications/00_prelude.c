// crust macOS notifications — compiled at launch by bun:ffi's cc().
//
// The same four rules as shim.c, each measured in DESIGN.md §2:
//
//  1. EVERY objc_msgSend call site casts to a FIXED prototype. A plain
//     `extern void *objc_msgSend(void *, void *, ...)` compiles and delivers
//     wrong arguments with no diagnostic.
//  2. No framework headers. <AppKit/AppKit.h>, <Foundation/Foundation.h> and
//     <UserNotifications/UserNotifications.h> are unreachable from TinyCC, so
//     every symbol is a hand-written extern over void *.
//  3. No struct crosses bun:ffi. The block literals below are built, kept and
//     consumed entirely on this side.
//  4. The title and body cross as NUL-terminated byte buffers, never as objects:
//     a short ASCII NSString is a tagged pointer and cannot round-trip.
//
// Two delivery paths, and the status says which one actually ran:
//
//   UNUserNotificationCenter   the real API. `+currentNotificationCenter` aborts
//                              the process with an NSInternalInconsistencyException
//                              when the process has no bundle identity, and an
//                              ObjC exception is a SIGABRT with no JavaScript
//                              error, so this path is entered only when
//                              -[NSBundle bundleIdentifier] is non-nil. Measured
//                              here: the class resolves, the identifier is nil,
//                              so on this machine the fallback is the live path.
//   NSUserNotificationCenter   deprecated, still present, and the only path an
//                              unbundled process can use. It has no authorization
//                              call and no delivery report at all.
//
// Status codes, mirrored by NOTIFICATION_STATUS in notifications.ts:
#define NF_DELIVERED 0 // the OS accepted the notification and reported no error
#define NF_AUTH 1      // authorization pending or denied: nothing was delivered
#define NF_MISSING 2   // a class or selector is absent, or neither path is reachable
#define NF_ERROR 3     // the API answered with an error

#define NF_REASON_BYTES 512
#define NF_SKIP_BYTES 192
#define NF_AUTH_WAIT_MS 1500
#define NF_DELIVER_WAIT_MS 1500

typedef void *obj_t;

extern obj_t objc_msgSend(void *self, void *sel, ...);
extern obj_t objc_getClass(const char *name);
extern obj_t sel_registerName(const char *name);
extern void *class_getInstanceMethod(void *cls, void *sel);
extern int usleep(unsigned int usec);

// --- state -----------------------------------------------------------------

static char nf_reason[NF_REASON_BYTES]; // why the last post ended as it did
static char nf_skip[NF_SKIP_BYTES];     // why UNUserNotificationCenter was skipped
static int nf_center;                   // 0 none, 1 UNUserNotificationCenter, 2 the deprecated center
static int nf_counter;                  // request identifier sequence

