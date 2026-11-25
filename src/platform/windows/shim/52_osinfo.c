// --- OS information --------------------------------------------------------
// The three facts `crust:os.info` cannot get from Bun: the product version, the user's locale and
// the time since boot. Everything else that command answers (`platform`, `arch`, `family`,
// `exeExtension`, `hostname`) is read in TypeScript, because every platform has it.
//
// **RtlGetVersion, not GetVersionExW.** Since Windows 8.1 the documented call reports 6.2 to any
// process without a compatibility manifest, and a crust app carries none — the real build is only
// available from ntdll. It is also the honest reading of "from the OS itself".

#define SHIM_LOCALE_CHARS 85 /* LOCALE_NAME_MAX_LENGTH */

// RTL_OSVERSIONINFOW: five 32-bit fields then WCHAR szCSDVersion[128]. 276 bytes, 4-byte aligned.
typedef struct {
	unsigned int size;
	unsigned int major;
	unsigned int minor;
	unsigned int build;
	unsigned int platform;
	shim_wchar servicePack[128];
} shim_os_version_info;

static shim_os_version_info g_os_version;
// 0 not tried, 1 read, -1 refused. The call is made once: the build cannot change in a session.
static int g_os_version_state;
static shim_wchar g_os_locale[SHIM_LOCALE_CHARS];
static char g_os_locale_utf8[SHIM_LOCALE_CHARS];

// Defined in `50_clipboard.c`, which compiles before this part.
static int shim_utf8(const shim_wchar *src, int srclen, char *dst, int cap);

static int shim_os_version_read(void) {
	if (g_os_version_state) return g_os_version_state > 0;
	g_os_version_state = -1;
	if (!shim_win32_load() || !RtlGetVersion) return 0;
	// `size` is the only field RtlGetVersion reads before it writes, and it must be set.
	g_os_version.size = (unsigned int)sizeof(shim_os_version_info);
	if (RtlGetVersion(&g_os_version) != 0) return 0;
	g_os_version_state = 1;
	return 1;
}

// 0 major, 1 minor, 2 build; -1 when the version could not be read. Three calls rather than a
// packed number, so a component cannot be misread as its neighbour.
int shim_os_version(int component) {
	if (!shim_os_version_read()) return -1;
	if (component == 0) return (int)g_os_version.major;
	if (component == 1) return (int)g_os_version.minor;
	if (component == 2) return (int)g_os_version.build;
	return -1;
}

// The user's locale as the BCP-47 tag Windows writes — "en-GB", not "en_GB.UTF-8" — because
// GetUserDefaultLocaleName is the call that already answers in that form. Empty when it cannot.
const char *shim_os_locale(void) {
	g_os_locale_utf8[0] = 0;
	if (!shim_win32_load() || !GetUserDefaultLocaleName) return g_os_locale_utf8;
	int written = GetUserDefaultLocaleName(g_os_locale, SHIM_LOCALE_CHARS);
	if (written <= 0) return g_os_locale_utf8;
	g_os_locale[SHIM_LOCALE_CHARS - 1] = 0;
	int chars = 0;
	while (chars < SHIM_LOCALE_CHARS && g_os_locale[chars]) chars++;
	shim_utf8(g_os_locale, chars, g_os_locale_utf8, (int)sizeof(g_os_locale_utf8));
	return g_os_locale_utf8;
}

// Seconds since boot, from GetTickCount64 — the 64-bit counter, so no 49-day wrap. Windows does not
// count time spent asleep in this counter, which is why the adapter documents it as awake time.
double shim_os_uptime(void) {
	// -1 is the refusal sentinel: 0.0 is a real reading in the first second after boot.
	if (!shim_win32_load() || !GetTickCount64) return -1.0;
	return (double)GetTickCount64() / 1000.0;
}
