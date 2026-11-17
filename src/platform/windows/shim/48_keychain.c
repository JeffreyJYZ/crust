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

// advapi32's credential store. CRED_TYPE_GENERIC is 1, CRED_PERSIST_LOCAL_MACHINE is 2.
static int (*CredWriteW)(void *credential, kc_dword flags);
static int (*CredReadW)(const kc_wchar *target, kc_dword type, kc_dword flags, void **credential);
static int (*CredDeleteW)(const kc_wchar *target, kc_dword type, kc_dword flags);
static void (*CredFree)(void *buffer);

#define SHIM_KC_UTF8 65001u
#define SHIM_KC_TARGET_MAX 2048
#define SHIM_KC_BLOB_MAX 2560

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
	if (!MultiByteToWideChar) return 0;
	kc_h advapi = LoadLibraryA("advapi32.dll");
	if (!advapi) return 0;
	CredWriteW = (int (*)(void *, kc_dword))GetProcAddress(advapi, "CredWriteW");
	CredReadW = (int (*)(const kc_wchar *, kc_dword, kc_dword, void **))GetProcAddress(
	    advapi, "CredReadW");
	CredDeleteW = (int (*)(const kc_wchar *, kc_dword, kc_dword))GetProcAddress(advapi,
	                                                                             "CredDeleteW");
	CredFree = (void (*)(void *))GetProcAddress(advapi, "CredFree");
	if (!CredWriteW || !CredReadW || !CredDeleteW || !CredFree) return 0;
	kc_state = 1;
	return 1;
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
	kc_wchar target[SHIM_KC_TARGET_MAX];
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

// Bytes into `dst` and the full length, -1 nothing stored, -2 a name was unusable.
long long shim_keychain_get(const char *service, long long slen, const char *account, long long alen,
                            char *dst, long long cap) {
	if (!shim_keychain_available()) return -1;
	if (!dst || cap <= 0) return -2;
	kc_wchar target[SHIM_KC_TARGET_MAX];
	if (kc_target(service, slen, account, alen, target, SHIM_KC_TARGET_MAX) != 0) return -2;
	void *found = 0;
	// 1168 ERROR_NOT_FOUND is "no entry", which is a normal answer rather than a failure.
	if (!CredReadW(target, 1, 0, &found) || !found) return -1;
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
	kc_wchar target[SHIM_KC_TARGET_MAX];
	if (kc_target(service, slen, account, alen, target, SHIM_KC_TARGET_MAX) != 0) return -2;
	if (CredDeleteW(target, 1, 0)) return 1;
	// The same ERROR_NOT_FOUND: nothing was stored, so the entry the caller named is gone.
	return 0;
}
