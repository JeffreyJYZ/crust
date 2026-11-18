// --- OS information --------------------------------------------------------
// The one `os.info` fact GLib owns: the user's language list. The product version is not a call at
// all — it is `/etc/os-release`, a file the distribution writes — so that half is read in TypeScript,
// where a missing or unreadable file is an ordinary error rather than a C crash.
//
// `g_get_language_names` answers the names the user's locale resolves to, most specific first
// ("en_GB.UTF-8", "en_GB", "en"). The first entry is the one a page should format dates in; the
// TypeScript half normalises it to a BCP-47 tag.

static const char *const *(*shim_g_get_language_names)(void);
static int shim_os_resolved;
static char shim_os_locale_text[128];

static void shim_os_resolve(void) {
	if (shim_os_resolved) return;
	void *h = shim_gtk_handle();
	shim_os_resolved = 1;
	if (!h) return;
	shim_g_get_language_names = shim_sym_or_null(h, "g_get_language_names");
}

// 1 when GLib can answer the language list; 0 names a GLib that cannot.
int shim_os_locale_ready(void) {
	shim_os_resolve();
	return shim_g_get_language_names ? 1 : 0;
}

// The first language name, bounded and NUL-terminated because it crosses bun:ffi as a cstring.
// Empty when GLib has no list, which the adapter reports rather than guessing "C".
const char *shim_os_locale(void) {
	shim_os_locale_text[0] = 0;
	if (!shim_os_locale_ready()) return shim_os_locale_text;
	const char *const *names = shim_g_get_language_names();
	if (!names || !names[0]) return shim_os_locale_text;
	int i = 0;
	while (names[0][i] && i < 120) {
		shim_os_locale_text[i] = names[0][i];
		i++;
	}
	shim_os_locale_text[i] = 0;
	return shim_os_locale_text;
}
