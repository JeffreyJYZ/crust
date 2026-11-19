/**
 * The native half of `crust:keychain` on macOS: `Security.framework` over `bun:ffi`, built on the
 * unit and shim in `keychain-ffi.ts`. This file is the adapter only, so the C seam and the plugin
 * seam stay separable.
 *
 * `SecItemUpdate` then `SecItemAdd` rather than Butter's delete-then-add, and every string crosses as
 * bytes into a caller-sized buffer, so a long secret is re-read at its exact length rather than
 * truncated at a guess.
 */

import type { KeychainAdapter } from "@/plugins/keychain";

import { darwinKeychainShim, KEYCHAIN_STATUS, type KeychainShim } from "./keychain-ffi.ts";

export {
	darwinKeychainShim,
	KEYCHAIN_STATUS,
	type KeychainShim,
	type KeychainUnit,
	keychainUnit,
	keychainUnitStatus,
} from "./keychain-ffi.ts";

/** The first buffer for a secret, and for the account list; anything larger is re-read exactly. */
export const SECRET_CHUNK = 8 * 1024;
export const LIST_CHUNK = 64 * 1024;

/**
 * Split the NUL-separated list the C half writes. NUL is the separator because the plugin refuses a
 * NUL in a name, so no account can carry one and the split is unambiguous. A duplicate is dropped and
 * the answer is sorted, so two reads of the same store answer the same list.
 */
export function splitAccounts(bytes: Uint8Array): string[] {
	const text = new TextDecoder().decode(bytes);
	const seen = new Set<string>();
	for (const name of text.split("\0")) {
		if (name.length > 0) seen.add(name);
	}
	return [...seen].sort();
}

/** Build the keychain adapter. The unit compiles on the first command, not before. */
export function darwinKeychainAdapter(
	/** The keychain shim; overridable so a test drives this with fakes. */
	native: KeychainShim = darwinKeychainShim(),
): KeychainAdapter {
	const set = (service: string, account: string, secret: string): void => {
		const status = native.set(service, account, secret);
		if (status === KEYCHAIN_STATUS.ok) return;
		throw new Error(
			status === KEYCHAIN_STATUS.badName
				? "keychain: the service or account name is unusable"
				: "keychain: the OS keychain refused the write",
		);
	};

	const get = (service: string, account: string): string | null => {
		let buffer = new Uint8Array(SECRET_CHUNK);
		// A secret can grow between the size probe and the read. Re-read at the reported size at
		// most three times, then refuse: a truncated secret is worse than a refusal (a half token
		// is silently wrong, a refusal is loud). Never decode a clamped prefix.
		for (let attempt = 0; attempt < 3; attempt++) {
			const length = native.get(service, account, buffer);
			// "Not stored" is the normal answer; the plugin turns it into `{ found: false }`.
			if (length === KEYCHAIN_STATUS.refused) return null;
			if (length < 0) throw new Error("keychain: the OS keychain refused the read");
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
		const status = native.delete(service, account);
		if (status === 1) return true;
		// Nothing stored is the same success: the entry the caller named is gone.
		if (status === 0) return false;
		throw new Error("keychain: the OS keychain refused the delete");
	};

	const list = (service: string): string[] => {
		let buffer = new Uint8Array(LIST_CHUNK);
		// Same bounded retry as `get`; a list that keeps growing is refused, never truncated.
		for (let attempt = 0; attempt < 3; attempt++) {
			const length = native.list(service, buffer);
			if (length < 0) throw new Error("keychain: the OS keychain refused the list");
			if (length <= buffer.length) return splitAccounts(buffer.subarray(0, length));
			buffer = new Uint8Array(length);
		}
		throw new Error(
			"keychain: the account list kept growing between reads; refusing a truncated list",
		);
	};

	return { platform: "darwin", set, get, delete: remove, list };
}
