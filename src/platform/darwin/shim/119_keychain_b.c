// --- keychain (read, delete, list) -----------------------------------------
// The second half of the Security.framework unit. Split from 118_keychain_a.c only
// because that file would otherwise pass the 200-line cap; the two compile as one
// translation unit under `platform/darwin/keychain.ts`, so `kc_cfstring`, `kc_dict`
// and `kc_query` are shared rather than repeated.

extern void *CFArrayGetCount(void *array);
extern void *CFArrayGetValueAtIndex(void *array, long index);
extern void *kSecMatchLimitOne;
extern void *kCFBooleanTrue;

// Copy one item's bytes into the caller's buffer and report the full length, so a
// caller whose buffer was too small asks again with an exact one instead of
// silently truncating a private key.
long long shim_keychain_get(const char *service, long long slen, const char *account,
                            long long alen, char *dst, long long cap) {
	if (!shim_keychain_available()) return -1;
	if (!service || !account || slen <= 0 || alen <= 0 || !dst || cap <= 0) return -2;
	void *svc = 0;
	void *acct = 0;
	void *query = kc_query(service, slen, account, alen, &svc, &acct);
	if (!query) return -3;
	// Return the data rather than the attributes, so one match is one byte copy.
	// A CFDictionary value must be a CFTypeRef, so `kCFBooleanTrue` is the exported
	// symbol and never a cast from 1 — a cast compiles and hands CF a pointer to
	// address 1, which faults inside the framework.
	const void *mk[2] = {kSecReturnData, kSecMatchLimit};
	const void *mv[2] = {kCFBooleanTrue, kSecMatchLimitOne};
	void *match = mv[0] && mv[1] ? kc_dict(mk, mv, 2) : 0;
	long long answer = -3;
	if (match) {
		void *result = 0;
		int found = SecItemCopyMatching(match, &result);
		CFRelease(match);
		if (found == 0 && result) {
			long length = CFDataGetLength(result);
			const unsigned char *bytes = CFDataGetBytePtr(result);
			if (bytes && length >= 0) {
				long long copied = length < cap - 1 ? (long long)length : cap - 1;
				for (long long i = 0; i < copied; i++) dst[i] = (char)bytes[i];
				dst[copied] = 0;
				answer = (long long)length;
			}
			CFRelease(result);
		} else if (found == -25300) {
			// errSecItemNotFound: "not stored" is a normal answer, not a failure.
			answer = -1;
		}
	}
	CFRelease(query);
	CFRelease(svc);
	CFRelease(acct);
	return answer;
}

// 1 removed, 0 nothing was stored, -1 refused, -2 bad name, -3 could not build.
int shim_keychain_delete(const char *service, long long slen, const char *account, long long alen) {
	if (!shim_keychain_available()) return -1;
	if (!service || !account || slen <= 0 || alen <= 0) return -2;
	void *svc = 0;
	void *acct = 0;
	void *query = kc_query(service, slen, account, alen, &svc, &acct);
	if (!query) return -3;
	int found = SecItemDelete(query);
	CFRelease(query);
	CFRelease(svc);
	CFRelease(acct);
	if (found == 0) return 1;
	if (found == -25300) return 0;
	return -1;
}

// Every account under one service, written into `dst` NUL-separated, and the total
// byte count back. NUL is the separator because the plugin refuses a NUL in a name,
// so no account can contain one and the split is unambiguous. A caller counts the
// separators rather than parsing a second buffer.
long long shim_keychain_list(const char *service, long long slen, char *dst, long long cap) {
	if (!shim_keychain_available()) return -1;
	if (!service || slen <= 0 || !dst || cap <= 0) return -2;
	void *svc = kc_cfstring(service, slen);
	if (!svc) return -3;
	// The service-only query: no account key, so every entry under it matches.
	const void *qk[3] = {kSecClass, kSecAttrService, kSecMatchLimit};
	const void *qv[3] = {kSecClassGenericPassword, svc, kSecMatchLimitAll};
	void *query = qv[2] ? kc_dict(qk, qv, 3) : 0;
	long long total = -3;
	if (query) {
		void *result = 0;
		int found = SecItemCopyMatching(query, &result);
		CFRelease(query);
		if (found == 0 && result) {
			total = 0;
			long count = (long)CFArrayGetCount(result);
			for (long index = 0; index < count; index++) {
				void *item = CFArrayGetValueAtIndex(result, index);
				void *name = item ? CFDictionaryGetValue(item, kSecAttrAccount) : 0;
				char small[256];
				if (!name || !CFStringGetCString(name, small, 256, SHIM_KCF_UTF8)) continue;
				long length = 0;
				while (small[length]) length++;
				// The separator costs one byte and an overflow drops the account rather
				// than splitting a name, so a short buffer yields fewer accounts, never
				// a corrupt one.
				if (total + length + 1 > cap) continue;
				for (long i = 0; i < length; i++) dst[total + i] = small[i];
				dst[total + length] = 0;
				total += length + 1;
			}
			CFRelease(result);
		} else if (found == -25300) {
			total = 0;
		}
	}
	CFRelease(svc);
	return total;
}
