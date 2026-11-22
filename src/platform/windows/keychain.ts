/**
 * The native half of `crust:keychain` on Windows: `advapi32`'s credential store over `bun:ffi`, built
 * on the unit and shim in `keychain-ffi.ts`. The adapter only, so the C seam and the plugin seam stay
 * separable — the same split `platform/darwin/keychain.ts` has.
 *
 * `list` uses `CredEnumerateW` from the same advapi32 unit: the shim returns one account name at a
 * time and `null` ends the enumeration, so an empty store is a real empty answer rather than a
 * refusal. The prefix is matched in C with a NULL filter, so a service containing `*` or `?` stays
 * literal.
 */

import type { KeychainAdapter } from "@/plugins/keychain";

import {
	type WindowsKeychainShim,
	WINDOWS_KEYCHAIN_STATUS,
	windowsKeychainShim,
} from "./keychain-ffi.ts";

export {
	type WindowsKeychainShim,
	type WindowsKeychainUnit,
	WINDOWS_KEYCHAIN_STATUS,
	windowsKeychainShim,
	windowsKeychainUnit,
} from "./keychain-ffi.ts";

/** The first buffer for a secret; anything larger is re-read at its exact length. */
export const SECRET_CHUNK = 8 * 1024;

/**
 * `CredWriteW` keys a generic credential on one `service\account` target string. A backslash inside
 * either name would let two different (service, account) pairs address the same target — a write
 * under one pair would overwrite the other and `get` would answer it to both. Refuse it here, at the
 * adapter boundary, rather than let a name collide in C.
 */
function assertName(service: string, account: string): void {
	if (service.includes("\\") || account.includes("\\")) {
		throw new Error("keychain: a service or account may not contain a backslash on Windows");
	}
}

/** Build the keychain adapter. The unit compiles on the first command, not before. */
export function windowsKeychainAdapter(
	native: WindowsKeychainShim = windowsKeychainShim(),
): KeychainAdapter {
	const set = (service: string, account: string, secret: string): void => {
		assertName(service, account);
		const status = native.set(service, account, secret);
		if (status === WINDOWS_KEYCHAIN_STATUS.ok) return;
		// Name the OS call and status so the plugin's refusal is actionable, never a bare failure.
		throw new Error(
			status === WINDOWS_KEYCHAIN_STATUS.badName
				? "keychain: the service or account name is unusable"
				: `keychain: CredWriteW refused the write (status ${status})`,
		);
	};

	const get = (service: string, account: string): string | null => {
		assertName(service, account);
		let buffer = new Uint8Array(SECRET_CHUNK);
		// A secret can grow between the size probe and the read. Re-read at the reported size at
		// most three times, then refuse: a truncated secret is worse than a refusal (a half token
		// is silently wrong, a refusal is loud). Never decode a clamped prefix.
		for (let attempt = 0; attempt < 3; attempt++) {
			const length = native.get(service, account, buffer);
			// "Not stored" is the normal answer; the plugin turns it into `{ found: false }`.
			if (length === WINDOWS_KEYCHAIN_STATUS.refused) return null;
			if (length < 0)
				throw new Error(`keychain: CredReadW refused the read (status ${length})`);
			if (length <= buffer.length - 1) {
				return new TextDecoder().decode(buffer.subarray(0, length));
			}
			buffer = new Uint8Array(length + 1);
		}
		throw new Error(
			"keychain: the secret kept growing between reads; refusing a truncated secret",
		);
	};

	const remove = (service: string, account: string): boolean => {
		assertName(service, account);
		const status = native.delete(service, account);
		if (status === 1) return true;
		// Nothing stored is the same success: the entry the caller named is gone.
		if (status === 0) return false;
		throw new Error(`keychain: CredDeleteW refused the delete (status ${status})`);
	};

	const list = (service: string): string[] => {
		assertName(service, "");
		const accounts: string[] = [];
		for (let index = 0; ; index++) {
			const account = native.list(service, index);
			if (account === null) break;
			accounts.push(account);
		}
		return accounts.sort();
	};

	return { platform: "win32", set, get, delete: remove, list };
}
