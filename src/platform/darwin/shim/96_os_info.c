// --- system information: the second half of the opener unit -----------------
// Joined to 91_opener.c before cc() sees it, so it uses that file's op_t, OP_UTF8 and externs and
// is never compiled alone. NSProcessInfo, NSLocale and NSBundle need no window and no bundle of
// their own, which is why a command-line crust process can still report the real OS version.

// One component of -[NSProcessInfo operatingSystemVersionString], which reads "Version 27.0.1
// (Build 26A123)". The struct-returning -operatingSystemVersion would cross this boundary as a
// 24-byte aggregate, so the string is parsed here: 0 major, 1 minor, 2 patch, -1 absent.
int crust_os_version(int component) {
	if (component < 0 || component > 2) return -1;
	op_t cls = objc_getClass("NSProcessInfo");
	if (!cls) return -1;
	op_t info = ((op_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("processInfo"));
	if (!info) return -1;
	op_t text = ((op_t (*)(void *, void *))objc_msgSend)(
	    info, sel_registerName("operatingSystemVersionString"));
	if (!text) return -1;
	char buf[64];
	buf[0] = 0;
	if (!CFStringGetCString(text, buf, 64, OP_UTF8)) return -1;

	int i = 0;
	while (buf[i] && (buf[i] < '0' || buf[i] > '9')) i++; /* skips "Version" */
	int part = 0;
	while (buf[i] >= '0' && buf[i] <= '9') {
		int value = 0;
		while (buf[i] >= '0' && buf[i] <= '9') {
			value = value * 10 + (buf[i] - '0');
			i++;
		}
		if (part == component) return value;
		part++;
		if (buf[i] != '.') break;
		i++;
	}
	return -1;
}

// +[NSLocale preferredLanguages] first object — the identifier macOS resolved for this user, e.g.
// "en-GB". "" when the locale is unreadable, which the plugin reports as unknown.
const char *crust_os_locale(void) {
	static char buf[64];
	buf[0] = 0;
	op_t cls = objc_getClass("NSLocale");
	if (!cls) return buf;
	op_t languages = ((op_t (*)(void *, void *))objc_msgSend)(cls,
	                                                          sel_registerName("preferredLanguages"));
	if (!languages) return buf;
	op_t first = ((op_t (*)(void *, void *))objc_msgSend)(languages, sel_registerName("firstObject"));
	if (!first) return buf;
	CFStringGetCString(first, buf, 64, OP_UTF8);
	return buf;
}

// -[NSProcessInfo systemUptime] — seconds since boot, as a double because that is what the selector
// returns. 0.0 when unreadable, which the plugin refuses rather than reporting a zero-length uptime.
double crust_os_uptime(void) {
	op_t cls = objc_getClass("NSProcessInfo");
	if (!cls) return 0.0;
	op_t info = ((op_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("processInfo"));
	if (!info) return 0.0;
	return ((double (*)(void *, void *))objc_msgSend)(info, sel_registerName("systemUptime"));
}

// -[NSBundle infoDictionary] CFBundleShortVersionString — the app's own version, "" when the
// process is unbundled and therefore carries none.
const char *crust_os_app_version(void) {
	static char buf[64];
	buf[0] = 0;
	op_t cls = objc_getClass("NSBundle");
	if (!cls) return buf;
	op_t bundle = ((op_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("mainBundle"));
	if (!bundle) return buf;
	op_t plist = ((op_t (*)(void *, void *))objc_msgSend)(bundle, sel_registerName("infoDictionary"));
	if (!plist) return buf;
	op_t key = __CFStringMakeConstantString("CFBundleShortVersionString");
	if (!key) return buf;
	op_t value = ((op_t (*)(void *, void *, op_t))objc_msgSend)(plist,
	                                                           sel_registerName("objectForKey:"),
	                                                           key);
	if (!value) return buf;
	CFStringGetCString(value, buf, 64, OP_UTF8);
	return buf;
}
