// --- accessibility: trust and the app's own AX tree, for crust:accessibility --
// Compiled by platform/darwin/accessibility.ts. ApplicationServices is linked by name and no
// framework header is included; an AXUIElement never leaves this unit, and the tree is read through
// numbers alone.
// The app element is created from `getpid()`, so the walk is always this process's own tree: reading
// another app's tree would need its consent, and none of that is needed to prove ours is exposed.

typedef void *ax_t;

extern void CFRelease(ax_t cf);
extern long CFArrayGetCount(ax_t array);
extern ax_t CFArrayGetValueAtIndex(ax_t array, long index);
extern ax_t __CFStringMakeConstantString(const char *cstr);
extern ax_t CFDictionaryCreate(ax_t alloc, const void **keys, const void **values, long count,
                               const void *key_callbacks, const void *value_callbacks);
extern ax_t kCFBooleanTrue;
extern unsigned char AXIsProcessTrusted(void);
extern unsigned char AXIsProcessTrustedWithOptions(ax_t options);
extern ax_t AXUIElementCreateApplication(int pid);
extern int AXUIElementCopyAttributeValue(ax_t element, ax_t attribute, ax_t *value);
extern int getpid(void);

// kAXErrorSuccess is 0, so any other answer is the API refusing rather than an empty tree.
#define AX_OK 0

// The last answer, for a caller that wants a reason. Static storage: valid until the next call.
static char ax_reason[256];

static void ax_reason_set(const char *text) {
	long i = 0;
	while (text[i] && i < 255) {
		ax_reason[i] = text[i];
		i++;
	}
	ax_reason[i] = 0;
}

// A refusal that carries the AXError, because -25205 (AttributeUnsupported) and -25211 (APIDisabled)
// and -25208 (NotImplemented) mean three different things and a bare "refused" hides which.
static void ax_reason_code(const char *text, int code) {
	long i = 0;
	while (text[i] && i < 200) {
		ax_reason[i] = text[i];
		i++;
	}
	char digits[12];
	int count = 0;
	int negative = code < 0;
	unsigned int value = negative ? (unsigned int)(-code) : (unsigned int)code;
	if (value == 0) digits[count++] = '0';
	while (value > 0) {
		digits[count++] = (char)('0' + (value % 10));
		value /= 10;
	}
	ax_reason[i++] = ' ';
	ax_reason[i++] = '(';
	if (negative) ax_reason[i++] = '-';
	while (count > 0) ax_reason[i++] = digits[--count];
	ax_reason[i++] = ')';
	ax_reason[i] = 0;
}

const char *crust_ax_reason(void) { return ax_reason; }

// Proves the unit linked: a caller reads it and knows the C half is really there.
int crust_ax_abi(void) { return 1; }

// 1 when the process may use the accessibility API, 0 when it may not. A read, never a prompt.
int crust_ax_trusted(void) {
	int trusted = (int)AXIsProcessTrusted();
	ax_reason_set(trusted ? "the process is trusted" : "the process is not trusted");
	return trusted;
}

// Raises the system prompt once and answers the state after it: the dialog is answered by a human,
// so a 0 here means "asked, not granted yet", which is exactly what the caller must report.
int crust_ax_prompt(void) {
	ax_t keys[1];
	ax_t values[1];
	keys[0] = __CFStringMakeConstantString("AXTrustedCheckOptionPrompt");
	values[0] = kCFBooleanTrue;
	ax_t options = CFDictionaryCreate(0, (const void **)keys, (const void **)values, 1, 0, 0);
	if (!options) {
		ax_reason_set("the prompt options dictionary could not be built");
		return (int)AXIsProcessTrusted();
	}
	int trusted = (int)AXIsProcessTrustedWithOptions(options);
	CFRelease(options);
	ax_reason_set(trusted ? "trusted after the prompt" : "the prompt was raised, not granted yet");
	return trusted;
}

// Children of the app's first window: 0 or more, -1 when AX listed no windows, -2 when the API
// refused. A window is an AXUIElement inside this unit; only its child count crosses.
// Measured 2026-11-16: a process reading its OWN pid does not go through the system AX server — the
// call dispatches into AppKit's accessibility implementation locally (lwouis/alt-tab-macos,
// `attributes(_:pid:)`), and this app's own read answered an empty AXWindows list while its window
// was on screen. A DIFFERENT process reading a background app gets its windows (Finder, measured
// 1), so an empty list here is not "no window is up" and must not be reported as if it were.
int crust_ax_element_count(void) {
	ax_t app = AXUIElementCreateApplication(getpid());
	if (!app) {
		ax_reason_set("AXUIElementCreateApplication answered nothing");
		return -2;
	}
	ax_t windows = 0;
	int status = AXUIElementCopyAttributeValue(app, __CFStringMakeConstantString("AXWindows"),
	                                          &windows);
	CFRelease(app);
	if (status != AX_OK || !windows) {
		ax_reason_code("the AX API refused AXWindows", status);
		return -2;
	}
	int count = -1;
	long window_count = CFArrayGetCount(windows);
	if (window_count <= 0) {
		ax_reason_set("AXWindows answered an empty list for this process");
	} else {
		ax_t window = CFArrayGetValueAtIndex(windows, 0);
		if (!window) {
			ax_reason_set("the first window was not an AX element");
			// -1 is reserved for an empty AXWindows list. Every other negative is a refusal, and
			// the value names the call: -2 AXWindows, -3 AXChildren. A refused AXChildren used to
			// return -1, so the TS adapter reported a permission failure as "no windows listed".
			count = -3;
		} else {
			ax_t children = 0;
			int child_status = AXUIElementCopyAttributeValue(
			    window, __CFStringMakeConstantString("AXChildren"), &children);
			if (child_status != AX_OK || !children) {
				ax_reason_code("the AX API refused AXChildren on the first window", child_status);
				count = -3;
			} else {
				count = (int)CFArrayGetCount(children);
				CFRelease(children);
				ax_reason_set(count > 0 ? "the window exposes AX children" : "the window has no children");
			}
		}
	}
	CFRelease(windows);
	return count;
}
