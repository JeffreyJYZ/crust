// --- locale: the app's preferred language, its own unit ----------------------
// Compiled by platform/darwin/locale.ts and deliberately absent from SHIM_PARTS: NSLocale needs no
// window, and nothing here belongs in the window shim's unit. The shim's four rules hold — one fixed
// prototype per objc_msgSend, no framework header, no object and no struct across bun:ffi, and every
// string built from bytes on this side, because a short ASCII NSString is a tagged pointer that
// cannot cross the boundary.

typedef void *lc_t;

extern lc_t objc_msgSend(void *self, void *sel, ...);
extern lc_t objc_getClass(const char *name);
extern lc_t sel_registerName(const char *name);
extern int CFStringGetCString(void *s, char *buf, long size, unsigned int encoding);

#define LC_UTF8 0x08000100 /* kCFStringEncodingUTF8 */

// +[NSLocale preferredLanguages] firstObject — the identifier macOS resolved for this user, e.g.
// "en-GB", which is the same list System Settings > Language & Region orders. "" when the locale is
// unreadable, which the adapter refuses rather than reporting an empty language.
// Static storage: valid until the next call.
const char *crust_locale_preferred(void) {
	static char buf[64];
	buf[0] = 0;
	lc_t cls = objc_getClass("NSLocale");
	if (!cls) return buf;
	lc_t languages = ((lc_t (*)(void *, void *))objc_msgSend)(cls,
	                                                          sel_registerName("preferredLanguages"));
	if (!languages) return buf;
	lc_t first = ((lc_t (*)(void *, void *))objc_msgSend)(languages, sel_registerName("firstObject"));
	if (!first) return buf;
	CFStringGetCString(first, buf, 64, LC_UTF8);
	return buf;
}
