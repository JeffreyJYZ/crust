/**
 * The C the parity probe's AX helper compiles at run time, kept as text because a built `.app` has no
 * readable source tree: it is written to a content-hashed temp file before `cc()` sees it, the device
 * the framework's own units use.
 * The helper runs as a SEPARATE process and reads ANOTHER pid, so the answer is what the system AX
 * server reports for that app — not what AppKit answers locally when a process reads itself, which is
 * the measurement that told us nothing.
 */

export const AX_PROBE_SOURCE = `// Read another process's AX window list and its first window's children.
typedef void *ax_t;

extern ax_t AXUIElementCreateApplication(int pid);
extern int AXUIElementCopyAttributeValue(ax_t element, ax_t attribute, ax_t *value);
extern ax_t __CFStringMakeConstantString(const char *cstr);
extern long CFArrayGetCount(ax_t array);
extern ax_t CFArrayGetValueAtIndex(ax_t array, long index);
extern void CFRelease(ax_t cf);

static int probe_status;
static int probe_children;

int probe_status_value(void) { return probe_status; }
int probe_children_value(void) { return probe_children; }

// The AXWindows count, or -1 when the call failed; probe_status_value() carries the AXError.
int probe_windows(int pid) {
	probe_status = 0;
	probe_children = -1;
	ax_t app = AXUIElementCreateApplication(pid);
	if (!app) {
		probe_status = -999;
		return -1;
	}
	ax_t windows = 0;
	probe_status =
	    AXUIElementCopyAttributeValue(app, __CFStringMakeConstantString("AXWindows"), &windows);
	CFRelease(app);
	if (probe_status != 0 || !windows) return -1;
	long count = CFArrayGetCount(windows);
	if (count > 0) {
		ax_t window = CFArrayGetValueAtIndex(windows, 0);
		if (window) {
			ax_t children = 0;
			int child_status = AXUIElementCopyAttributeValue(
			    window, __CFStringMakeConstantString("AXChildren"), &children);
			if (child_status == 0 && children) {
				probe_children = (int)CFArrayGetCount(children);
				CFRelease(children);
			}
		}
	}
	CFRelease(windows);
	return (int)count;
}
`;
