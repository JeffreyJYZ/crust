/**
 * The native half of `crust:keychain` on Windows: `advapi32`'s credential store over `bun:ffi`, built
 * on the unit and shim in `keychain-ffi.ts`. The adapter only, so the C seam and the plugin seam stay
 * separable — the same split `platform/darwin/keychain.ts` has.
 *
 * `list` is absent on purpose: `CredEnumerateW` would be a fifth binding and a wildcard match, so the
 * plugin answers `not-implemented` naming it rather than an empty array that reads as "nothing is
 * stored". `get`, `set` and `delete` are the whole surface, and they are the ones a page needs.
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

/** Build the keychain adapter. The unit compiles on the first command, not before. */
export function windowsKeychainAdapter(
	native: WindowsKeychainShim = windowsKeychainShim(),
): KeychainAdapter {
	const set = (service: string, account: string, secret: string): void => {
		const status = native.set(service, account, secret);
		if (status === WINDOWS_KEYCHAIN_STATUS.ok) return;
		throw new Error(
			status === WINDOWS_KEYCHAIN_STATUS.badName
				? "keychain: the service or account name is unusable"
				: "keychain: the Windows credential store refused the write",
		);
	};

	const get = (service: string, account: string): string | null => {
		let buffer = new Uint8Array(SECRET_CHUNK);
		let length = native.get(service, account, buffer);
		// "Not stored" is the normal answer; the plugin turns it into `{ found: false }`.
		if (length === WINDOWS_KEYCHAIN_STATUS.refused) return null;
		if (length < 0) throw new Error("keychain: the Windows credential store refused the read");
		// Re-read at the exact length rather than handing back a truncated secret.
		if (length > buffer.length - 1) {
			buffer = new Uint8Array(length + 1);
			length = native.get(service, account, buffer);
			if (length === WINDOWS_KEYCHAIN_STATUS.refused) return null;
			if (length < 0)
				throw new Error("keychain: the Windows credential store refused the read");
		}
		const bytes = Math.min(length, buffer.length - 1);
		return new TextDecoder().decode(buffer.subarray(0, bytes));
	};

	const remove = (service: string, account: string): boolean => {
		const status = native.delete(service, account);
		if (status === 1) return true;
		// Nothing stored is the same success: the entry the caller named is gone.
		if (status === 0) return false;
		throw new Error("keychain: the Windows credential store refused the delete");
	};

	// No `list`: see the header. The plugin answers `not-implemented` naming `CredEnumerateW`.
	return { platform: "win32", set, get, delete: remove };
}
