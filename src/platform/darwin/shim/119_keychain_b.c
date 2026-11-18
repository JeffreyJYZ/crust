// --- keychain (read, delete, list) -----------------------------------------
// The second half of the Security.framework unit. Split from 118_keychain_a.c only
// because that file would otherwise pass the 200-line cap; the two compile as one
// translation unit under `platform/darwin/keychain.ts`, so `kc_cfstring`, `kc_dict`
// and `kc_query` are shared rather than repeated.

extern long CFArrayGetCount(void *array);
extern void *CFArrayGetValueAtIndex(void *array, long index);
extern long CFStringGetLength(void *string);
extern long CFStringGetMaximumSizeForEncoding(long length, unsigned int encoding);
extern void *kSecMatchLimitOne;
extern void *kCFBooleanTrue;

// Copy one item's bytes into the caller's buffer and report the full length, so a
// caller whose buffer was too small asks again with an exact one instead of
// silently truncating a private key.
long long shim_keychain_get(const char *service, long long slen, const char *account,
                            long long alen, char *dst, long long cap) {
	if (!shim_keychain_available()) return -1;
	if (!service || !account || slen <= 0 || alen <= 0 || !dst || cap <= 0) return -2;
	void *svc = kc_cfstring(service, slen);
	void *acct = kc_cfstring(account, alen);
	if (!svc || !acct) {
		if (svc) CFRelease(svc);
		if (acct) CFRelease(acct);
		return -3;
	}
	// **One** dictionary, five keys. An earlier version built the class/service/account query and a
	// second dictionary holding only `kSecReturnData`/`kSecMatchLimit`, then searched with the
	// second — a query that names no class says nothing about what to look for, so every read
	// answered -3 and a stored credential could never be read back. A CFDictionary value must be a
	// CFTypeRef, so `kCFBooleanTrue` is the exported symbol and never a cast from 1.
	const void *keys[5] = {kSecClass, kSecAttrService, kSecAttrAccount, kSecReturnData,
	                       kSecMatchLimit};
	const void *values[5] = {kSecClassGenericPassword, svc, acct, kCFBooleanTrue,
	                         kSecMatchLimitOne};
	void *query = (values[3] && values[4]) ? kc_dict(keys, values, 5) : 0;
	long long answer = -3;
	if (query) {
		void *result = 0;
		int found = SecItemCopyMatching(query, &result);
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
		CFRelease(query);
	}
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
	// The service-only query, with `kSecReturnAttributes`: without a return type the result is an
	// array of item *refs*, and `CFDictionaryGetValue` on a non-dictionary is not an error code —
	// it is a C++ exception that takes the process down, which this list command did.
	const void *qk[4] = {kSecClass, kSecAttrService, kSecMatchLimit, kSecReturnAttributes};
	const void *qv[4] = {kSecClassGenericPassword, svc, kSecMatchLimitAll, kCFBooleanTrue};
	void *query = (qv[2] && qv[3]) ? kc_dict(qk, qv, 4) : 0;
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
				if (!name) continue;
				// Size from the name, never a fixed 256-byte stack buffer: the old hard limit
				// made CFStringGetCString fail for any longer account, and `continue` turned that
				// into a silent omission — set accepts the name and get finds it, but list hides it.
				long units = CFStringGetLength(name);
				long room = CFStringGetMaximumSizeForEncoding(units, SHIM_KCF_UTF8) + 1;
				if (room <= 0) { total = -3; break; }
				if (room > cap - total) {
					// It will not fit in what is left. Report the room it needs so the adapter
					// re-reads with an exact buffer, the signal shim_keychain_get already gives.
					// `room` is an upper bound on the UTF-8 bytes, so the re-read has enough.
					total += room;
					continue;
				}
				// Enough room: CFStringGetCString writes the name and its NUL where the
				// separator belongs, so the next account starts at that NUL plus one.
				if (!CFStringGetCString(name, dst + total, room, SHIM_KCF_UTF8)) {
					total = -3;
					break;
				}
				while (dst[total]) total++;
				total++;
			}
			CFRelease(result);
		} else if (found == -25300) {
			total = 0;
		}
	}
	CFRelease(svc);
	return total;
}
