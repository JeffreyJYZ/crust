// --- accessibility: move assistive focus to a window ------------------------
// Part 2 of the page-facing AX unit, concatenated after 106_accessibility_page.c into the same
// translation unit: it shares ax_window, the CF constructors and the ownership rule from there.
// Matching an AX element by window number is only a precondition. AppKit may still refuse every
// AXUIElementSetAttributeValue (an untrusted process, a panel, a window on another Space), so the
// answer reports what was actually applied instead of claiming that a match moved VoiceOver.

// 0 = no window/AX element matched, 1 = the two focus attributes were set and posted, 2 = a window
// matched but AppKit refused one of the two attributes that move assistive focus.
int crust_ax_focus(const char *label) {
	obj_t window = ax_window(label);
	if (!window) return 0;
	ax_t app = AXUIElementCreateApplication(getpid());
	if (!app) return 0;
	ax_t list = 0;
	if (AXUIElementCopyAttributeValue(app, __CFStringMakeConstantString("AXWindows"), &list) != AX_OK ||
	    !list) {
		CFRelease(app);
		return 0;
	}
	long long wanted = ((long long (*)(void *, void *))objc_msgSend)(window,
	                                                                sel_registerName("windowNumber"));
	ax_t target = 0;
	long n = CFArrayGetCount(list);
	for (long i = 0; i < n && !target; i++) {
		ax_t element = CFArrayGetValueAtIndex(list, i);
		ax_t number_value = 0;
		if (AXUIElementCopyAttributeValue(element, __CFStringMakeConstantString("AXWindowNumber"),
		                                  &number_value) != AX_OK ||
		    !number_value)
			continue;
		long long candidate = ((long long (*)(void *, void *))objc_msgSend)(
		    number_value, sel_registerName("longLongValue"));
		CFRelease(number_value);
		if (candidate == wanted) target = element;
	}
	if (!target) {
		CFRelease(list);
		CFRelease(app);
		return 0;
	}

	// AXError 0 is kAXErrorSuccess. A refused set is a normal answer, not an exception, so check
	// every result and post only the changes AppKit accepted — a post cannot make a refusal stick.
	int set_app = AXUIElementSetAttributeValue(app, __CFStringMakeConstantString("AXFocusedWindow"),
	                                           target);
	int set_focused = AXUIElementSetAttributeValue(target,
	                                              __CFStringMakeConstantString("AXFocused"),
	                                              kCFBooleanTrue);
	int set_main = AXUIElementSetAttributeValue(target, __CFStringMakeConstantString("AXMain"),
	                                           kCFBooleanTrue);
	if (set_app == AX_OK)
		NSAccessibilityPostNotificationWithUserInfo(
		    app, __CFStringMakeConstantString("AXFocusedWindowChanged"), 0);
	if (set_focused == AX_OK)
		NSAccessibilityPostNotificationWithUserInfo(
		    target, __CFStringMakeConstantString("AXFocusedUIElementChanged"), 0);
	CFRelease(list);
	CFRelease(app);
	// AXMain is a courtesy; AXFocusedWindow and AXFocused are what move assistive focus.
	(void)set_main;
	return set_app == AX_OK && set_focused == AX_OK ? 1 : 2;
}
