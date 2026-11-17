// --- keychain (Security.framework) -----------------------------------------
// Its own compilation unit, compiled by `platform/darwin/keychain.ts` with
// `-framework Security -framework CoreFoundation` — the same shape 90_clipboard.c
// uses, and for the same reason: none of this needs a window, so it does not
// belong in the window shim. The four measured rules apply unchanged: one fixed
// prototype per call, no framework header, no object or struct across the
// boundary, and every string stays in C.
//
// Nothing here shells out. Butter runs `security add-generic-password -w …`,
// which puts the secret in the process list for the life of the write; these are
// in-process calls that take bytes from a caller buffer and never build an
// argument vector at all.

extern void *CFStringCreateWithBytes(void *alloc, const unsigned char *bytes, long numBytes,
                                     unsigned int encoding, int isExternal);
extern void *CFDataCreate(void *alloc, const unsigned char *bytes, long length);
extern void *CFDictionaryCreate(void *alloc, const void **keys, const void **values, long count,
                                const void *keyCallbacks, const void *valueCallbacks);
extern void *CFDictionaryGetValue(void *dict, const void *key);
extern int CFStringGetCString(void *s, char *buf, long size, unsigned int encoding);
extern long CFDataGetLength(void *data);
extern const unsigned char *CFDataGetBytePtr(void *data);
extern void CFRelease(void *obj);

extern int SecItemAdd(void *attributes, void *result);
extern int SecItemCopyMatching(void *query, void *result);
extern int SecItemUpdate(void *query, void *attributes);
extern int SecItemDelete(void *query);

// The framework's own key objects, referenced rather than rebuilt: a hand-typed
// "svce" silently addresses a key nothing matches, so the symbol is the contract.
extern void *kSecClass;
extern void *kSecClassGenericPassword;
extern void *kSecAttrService;
extern void *kSecAttrAccount;
extern void *kSecValueData;
extern void *kSecReturnData;
extern void *kSecMatchLimit;
extern void *kSecMatchLimitAll;
extern void *kCFTypeDictionaryKeyCallBacks;
extern void *kCFTypeDictionaryValueCallBacks;

#define SHIM_KCF_UTF8 0x08000100u

// 0 worked, -1 the store refused, -2 a name was unusable, -3 out of memory.
// A framework OSStatus never crosses the boundary, so the TypeScript half reads
// one small table and the Security codes stay in this file.
static int kc_ready;

// One CFString from bytes. Length 0 is the empty string, which is a real account
// a caller may use, so only a null buffer is refused.
static void *kc_cfstring(const char *bytes, long long length) {
	if (!bytes || length < 0) return 0;
	return CFStringCreateWithBytes(0, (const unsigned char *)bytes, (long)length, SHIM_KCF_UTF8, 0);
}

// The type callbacks are the framework's own, so every value is retained for the
// life of the dictionary — which is what lets `set` hand over caller bytes without
// keeping the buffer alive itself.
static void *kc_dict(const void **keys, const void **values, long count) {
	return CFDictionaryCreate(0, keys, values, count,
	                          (const void *)kCFTypeDictionaryKeyCallBacks,
	                          (const void *)kCFTypeDictionaryValueCallBacks);
}

// 1 when Security.framework answers every symbol this part sends. A test asserts
// this without touching the store, so "the unit compiled" and "the framework can
// serve it" stay separate answers.
int shim_keychain_available(void) {
	if (kc_ready) return kc_ready > 0;
	kc_ready = -1;
	if (!kSecClass || !kSecClassGenericPassword || !kSecAttrService) return 0;
	if (!kSecAttrAccount || !kSecValueData || !SecItemAdd) return 0;
	if (!SecItemCopyMatching || !SecItemDelete || !SecItemUpdate) return 0;
	kc_ready = 1;
	return 1;
}

// The three-entry query every command shares: class, service, account. Answers 0
// on a bad name or a dictionary that could not be built, so each caller gets one
// reason instead of three.
static void *kc_query(const char *service, long long slen, const char *account, long long alen,
                      void **out_service, void **out_account) {
	void *svc = kc_cfstring(service, slen);
	void *acct = kc_cfstring(account, alen);
	if (!svc || !acct) {
		if (svc) CFRelease(svc);
		if (acct) CFRelease(acct);
		return 0;
	}
	const void *keys[3] = {kSecClass, kSecAttrService, kSecAttrAccount};
	const void *values[3] = {kSecClassGenericPassword, svc, acct};
	void *query = kc_dict(keys, values, 3);
	if (!query) {
		CFRelease(svc);
		CFRelease(acct);
		return 0;
	}
	*out_service = svc;
	*out_account = acct;
	return query;
}

// Store or replace one credential. Update-then-add, not Butter's delete-then-add:
// a delete that lands before a failing add loses the credential outright, and the
// gap between the two is a window where the app has nothing stored.
int shim_keychain_set(const char *service, long long slen, const char *account, long long alen,
                      const char *secret, long long vlen) {
	if (!shim_keychain_available()) return -1;
	if (!service || !account || slen <= 0 || alen <= 0 || !secret || vlen < 0) return -2;
	void *svc = 0;
	void *acct = 0;
	void *query = kc_query(service, slen, account, alen, &svc, &acct);
	if (!query) return -3;
	void *data = CFDataCreate(0, (const unsigned char *)secret, (long)vlen);
	int status = -1;
	if (!data) {
		CFRelease(query);
		CFRelease(svc);
		CFRelease(acct);
		return -3;
	}
	const void *uk[1] = {kSecValueData};
	const void *uv[1] = {data};
	void *update = kc_dict(uk, uv, 1);
	if (!update) {
		CFRelease(data);
		CFRelease(query);
		CFRelease(svc);
		CFRelease(acct);
		return -3;
	}
	// errSecItemNotFound (-25300) is the only reason to add; any other failure here
	// is a real refusal and must not be papered over by an add that would fail too.
	int updated = SecItemUpdate(query, update);
	CFRelease(update);
	if (updated == 0) {
		status = 0;
	} else if (updated == -25300) {
		const void *ak[4] = {kSecClass, kSecAttrService, kSecAttrAccount, kSecValueData};
		const void *av[4] = {kSecClassGenericPassword, svc, acct, data};
		void *add = kc_dict(ak, av, 4);
		if (add) {
			status = SecItemAdd(add, 0) == 0 ? 0 : -1;
			CFRelease(add);
		}
	}
	CFRelease(data);
	CFRelease(query);
	CFRelease(svc);
	CFRelease(acct);
	return status;
}
