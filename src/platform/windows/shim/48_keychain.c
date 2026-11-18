// --- keychain (advapi32) ---------------------------------------------------
// Its own translation unit, compiled by `platform/windows/keychain-ffi.ts`, NOT part of the window
// shim (`shim-source.ts` never lists it). The window unit must stay one unit because its window
// procedure and COM tables share statics; a credential store has neither, and welding it in would
// move that unit's declared-pointer count and module list for a surface that needs no window.
//
// Same two rules as every other part: nothing is linked, and every entry point is a pointer resolved
// at runtime — TinyCC's PE import thunk for a DLL jumped to 0xFFFFFFFFFFFFFFFF on Windows x64
// (2026-11-16). Strings are UTF-16 here and consumed here; only ints and byte buffers cross bun:ffi.

typedef void *kc_h;
typedef unsigned short kc_wchar;
typedef unsigned int kc_dword;

extern kc_h LoadLibraryA(const char *name);
extern void *GetProcAddress(kc_h module, const char *name);

// Only two imports above, both kernel32, which TinyCC's PE runtime links for its own CRT.
static int (*MultiByteToWideChar)(kc_dword cp, kc_dword flags, const char *src, int srclen,
                                  kc_wchar *dst, int dstlen);
// Last-error is resolved at runtime like every other entry point, never imported: the PE import
// thunk defect applies to kernel32 too. It is what separates "not stored" from "store refused".
static kc_dword (*getLastError)(void);

// advapi32's credential store. CRED_TYPE_GENERIC is 1, CRED_PERSIST_LOCAL_MACHINE is 2.
static int (*CredWriteW)(void *credential, kc_dword flags);
static int (*CredReadW)(const kc_wchar *target, kc_dword type, kc_dword flags, void **credential);
static int (*CredDeleteW)(const kc_wchar *target, kc_dword type, kc_dword flags);
static void (*CredFree)(void *buffer);
static int (*CredEnumerateW)(const kc_wchar *filter, kc_dword flags, kc_dword *count, void ***array);

#define SHIM_KC_UTF8 65001u
#define SHIM_KC_TARGET_MAX 2048
#define SHIM_KC_BLOB_MAX 2560
// ERROR_NOT_FOUND is the normal "no such credential" answer. Every other code — access denied
// above all — is a refusal. A distinct negative keeps a refusal from reading as "nothing stored":
// -1 is that sentinel for get, so the read uses -3 and the adapter throws on any other negative.
#define SHIM_KC_ERROR_NOT_FOUND 1168u
#define SHIM_KC_REFUSED -3

// CREDENTIALW, laid out by hand because no SDK header is reachable from TinyCC. Five DWORD/pointer
// fields, the blob pointer, its size, then the tail fields; pointers are 8 bytes on x64.
typedef struct {
	kc_dword Flags;
	kc_dword Type;
	kc_wchar *TargetName;
	kc_wchar *Comment;
	kc_wchar *UserName;
	void *CredentialBlob;
	kc_dword CredentialBlobSize;
	kc_dword Persist;
	kc_dword AttributeCount;
	void *Attributes;
	kc_wchar *TargetAlias;
	kc_wchar *UserNameAlias;
} shim_credential;

static int kc_state;

// 1 when advapi32 answers every symbol this part sends.
int shim_keychain_available(void) {
	if (kc_state) return kc_state > 0;
	kc_state = -1;
	kc_h kernel = LoadLibraryA("kernel32.dll");
	if (!kernel) return 0;
	MultiByteToWideChar = (int (*)(kc_dword, kc_dword, const char *, int, kc_wchar *, int))
	    GetProcAddress(kernel, "MultiByteToWideChar");
	getLastError = (kc_dword (*)(void))GetProcAddress(kernel, "GetLastError");
	if (!MultiByteToWideChar || !getLastError) return 0;
	kc_h advapi = LoadLibraryA("advapi32.dll");
	if (!advapi) return 0;
	CredWriteW = (int (*)(void *, kc_dword))GetProcAddress(advapi, "CredWriteW");
	CredReadW = (int (*)(const kc_wchar *, kc_dword, kc_dword, void **))GetProcAddress(
	    advapi, "CredReadW");
	CredDeleteW = (int (*)(const kc_wchar *, kc_dword, kc_dword))GetProcAddress(advapi,
	                                                                             "CredDeleteW");
	CredFree = (void (*)(void *))GetProcAddress(advapi, "CredFree");
	CredEnumerateW = (int (*)(const kc_wchar *, kc_dword, kc_dword *, void ***))GetProcAddress(
	    advapi, "CredEnumerateW");
	if (!CredWriteW || !CredReadW || !CredDeleteW || !CredFree || !CredEnumerateW) return 0;
	kc_state = 1;
	return 1;
}

// The one rule both refusal paths share. Exported so a test compiles and calls the real C mapping
// on any host — the read and delete callers pass their own "not stored" and "refused" sentinels.
long long shim_keychain_status(kc_dword error, long long notFound, long long refused) {
	return error == SHIM_KC_ERROR_NOT_FOUND ? notFound : refused;
}

// "service\account" as one target name: the two names a caller gives become the single string the
// credential store keys on, which is why neither may carry a NUL (the plugin refuses one).
static int kc_target(const char *service, long long slen, const char *account, long long alen,
                     kc_wchar *dst, int cap) {
	if (!service || !account || slen <= 0 || alen <= 0) return -2;
	int head = MultiByteToWideChar(SHIM_KC_UTF8, 0, service, (int)slen, dst, cap - 2);
	if (head <= 0) return -2;
	dst[head] = (kc_wchar)'\\';
	int tail = MultiByteToWideChar(SHIM_KC_UTF8, 0, account, (int)alen, dst + head + 1,
	                               cap - head - 2);
	if (tail <= 0) return -2;
	dst[head + 1 + tail] = 0;
	return 0;
}

// 0 stored, -1 the store refused, -2 a name was unusable.
int shim_keychain_set(const char *service, long long slen, const char *account, long long alen,
                      const char *secret, long long vlen) {
	if (!shim_keychain_available()) return -1;
	if (!secret || vlen < 0 || vlen > SHIM_KC_BLOB_MAX) return -2;
	static kc_wchar target[SHIM_KC_TARGET_MAX];
	if (kc_target(service, slen, account, alen, target, SHIM_KC_TARGET_MAX) != 0) return -2;
	shim_credential credential;
	credential.Flags = 0;
	credential.Type = 1;  // CRED_TYPE_GENERIC
	credential.TargetName = target;
	credential.Comment = 0;
	credential.UserName = target;
	// CredWriteW copies the blob, so a caller buffer is enough and nothing is retained.
	credential.CredentialBlob = (void *)secret;
	credential.CredentialBlobSize = (kc_dword)vlen;
	credential.Persist = 2;  // CRED_PERSIST_LOCAL_MACHINE
	credential.AttributeCount = 0;
	credential.Attributes = 0;
	credential.TargetAlias = 0;
	credential.UserNameAlias = 0;
	return CredWriteW(&credential, 0) ? 0 : -1;
}

// Bytes into `dst` and the full length, -1 nothing stored, -2 a name was unusable, -3 refused.
long long shim_keychain_get(const char *service, long long slen, const char *account, long long alen,
                            char *dst, long long cap) {
	if (!shim_keychain_available()) return -1;
	if (!dst || cap <= 0) return -2;
	static kc_wchar target[SHIM_KC_TARGET_MAX];
	if (kc_target(service, slen, account, alen, target, SHIM_KC_TARGET_MAX) != 0) return -2;
	void *found = 0;
	if (!CredReadW(target, 1, 0, &found)) {
		// Only ERROR_NOT_FOUND is "nothing stored". Access denied, a locked or a malformed store
		// is a refusal the adapter throws on — collapsing both into -1 hid the real failure.
		return shim_keychain_status(getLastError(), -1, SHIM_KC_REFUSED);
	}
	if (!found) return SHIM_KC_REFUSED;
	const shim_credential *credential = (const shim_credential *)found;
	long long length = (long long)credential->CredentialBlobSize;
	long long copied = length < cap - 1 ? length : cap - 1;
	const char *bytes = (const char *)credential->CredentialBlob;
	for (long long i = 0; i < copied; i++) dst[i] = bytes ? bytes[i] : 0;
	dst[copied] = 0;
	CredFree(found);
	return length;
}

// 1 removed, 0 nothing was stored, -1 refused, -2 a name was unusable.
int shim_keychain_delete(const char *service, long long slen, const char *account, long long alen) {
	if (!shim_keychain_available()) return -1;
	static kc_wchar target[SHIM_KC_TARGET_MAX];
	if (kc_target(service, slen, account, alen, target, SHIM_KC_TARGET_MAX) != 0) return -2;
	if (CredDeleteW(target, 1, 0)) return 1;
	// Only ERROR_NOT_FOUND means the entry was already gone. Any other code — access denied above
	// all — is a refusal, and returning 0 there is a lie the adapter turns into a silent success.
	return shim_keychain_status(getLastError(), 0, -1);
}

// The `index`-th account under `service`, as UTF-16LE bytes with a final NUL. Returns the byte count
// needed, 0 when the list ends, -2 a bad name, -3 a refusal. A NULL filter keeps * and ? literal, and
// CredFree owns the enumeration; the caller re-reads at the exact length when the buffer is too small.
long long shim_keychain_list(const char *service, long long slen, kc_dword index, char *dst, long long cap) {
	if (!shim_keychain_available()) return SHIM_KC_REFUSED;
	if (!service || slen <= 0 || slen > SHIM_KC_TARGET_MAX - 2 || !dst || cap < 2) return -2;
	static kc_wchar prefix[SHIM_KC_TARGET_MAX];
	int head = MultiByteToWideChar(SHIM_KC_UTF8, 0, service, (int)slen, prefix, SHIM_KC_TARGET_MAX - 2);
	if (head <= 0) return -2;
	prefix[head] = (kc_wchar)'\\';
	prefix[head + 1] = 0;
	kc_dword count = 0;
	void **array = 0;
	if (!CredEnumerateW(0, 0, &count, &array) || !array) return SHIM_KC_REFUSED;
	const kc_wchar *name = 0;
	for (kc_dword i = 0; i < count; i++) {
		const shim_credential *cred = (const shim_credential *)array[i];
		if (!cred || cred->Type != 1 || !cred->TargetName) continue;
		const kc_wchar *target = cred->TargetName;
		int j = 0;
		while (prefix[j] && target[j] && prefix[j] == target[j]) j++;
		if (prefix[j]) continue;
		if (index-- == 0) { name = target + head + 1; break; }
	}
	if (!name) { CredFree(array); return 0; }
	int chars = 0;
	while (name[chars]) chars++;
	long long needed = (chars + 1) * 2, copied = needed <= cap ? needed : cap;
	for (long long b = 0; b + 1 < copied; b += 2) {
		kc_wchar unit = name[b / 2];
		dst[b] = (char)(unit & 0xff);
		dst[b + 1] = (char)(unit >> 8);
	}
	CredFree(array);
	return needed;
}
