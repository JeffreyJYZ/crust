/**
 * The native half of `crust:keychain` on Linux: libsecret's synchronous simple API over the same
 * dlopen'd C shim GTK and WebKitGTK use. Verified 2026-11-18 from libsecret's own source:
 * `_secret_sync_new` creates a private `GMainContext` + `GMainLoop` and `_secret_sync_on_result`
 * quits it, so the `*_sync` calls need no running main loop in the caller — only a session bus and a
 * Secret Service provider (gnome-keyring / ksecretservice / KWallet). Chromium uses the same sync API
 * from a headless utility process, which is the real-world proof.
 *
 * The library is optional: nothing opens it until the first command, and a missing library or symbol
 * becomes a named error that names both libsecret and the package to install. GLib memory never
 * crosses bun:ffi — the C side copies the secret into a static buffer and frees the GError itself.
 */

import type { KeychainAdapter } from "@/plugins/keychain";
import { cstring } from "./cstring.ts";
import { shim } from "./shim-ffi.ts";

/** The Debian and Fedora packages that provide the library and a Secret Service provider. */
export const KEYRING_INSTALL_LINE =
	"Debian/Ubuntu: sudo apt install libsecret-1-0 gnome-keyring · " +
	"Fedora: sudo dnf install libsecret gnome-keyring";

/** The slice of the compiled shim this adapter uses, declared so a test can inject a fake. */
export interface LinuxKeychainNative {
	shim_keyring_open(): number;
	shim_keyring_set(service: Uint8Array, account: Uint8Array, secret: Uint8Array): number;
	shim_keyring_get(service: Uint8Array, account: Uint8Array, status: Int32Array): string | null;
	shim_keyring_delete(service: Uint8Array, account: Uint8Array): number;
	shim_lib_error_text(): string | null;
}

/** What the C side writes into the `status` out-parameter of `shim_keyring_get`. */
export const KEYRING_STATUS = {
	found: 1,
	missing: 0,
	refused: -1,
	tooLong: -2,
} as const;

/** Build the adapter. Opening libsecret is deferred to the first command, never import time. */
export function linuxKeychainAdapter(
	native: LinuxKeychainNative = shim().symbols,
): KeychainAdapter {
	let opened = false;

	/** Resolve libsecret once; a refusal names the library, the symbol and the install line. */
	function open(): void {
		if (opened) return;
		if (Number(native.shim_keyring_open() ?? 0) !== 1) {
			const detail = String(
				native.shim_lib_error_text() ?? "libsecret-1.so.0 could not load",
			);
			throw new Error(`crust keychain: ${detail}\n  ${KEYRING_INSTALL_LINE}`);
		}
		opened = true;
	}

	/** The shared refusal when a resolved library still answered no, so the message stays actionable. */
	function refused(what: string): never {
		const detail = String(native.shim_lib_error_text() ?? "libsecret refused the operation");
		throw new Error(`crust keychain: ${detail} (${what})\n  ${KEYRING_INSTALL_LINE}`);
	}

	const set = (service: string, account: string, secret: string): void => {
		// libsecret's sync API takes a NUL-terminated C string, so an interior NUL would store only
		// the prefix. Refuse at the adapter too: callers can use this boundary without the plugin.
		if (secret.includes("\0")) {
			throw new Error("crust keychain: a secret may not contain a NUL");
		}
		open();
		const ok = Number(
			native.shim_keyring_set(cstring(service), cstring(account), cstring(secret)) ?? 0,
		);
		if (ok !== 1) refused("secret_password_storev_sync");
	};

	const get = (service: string, account: string): string | null => {
		open();
		const status = new Int32Array(1);
		const value = native.shim_keyring_get(cstring(service), cstring(account), status);
		if (status[0] === KEYRING_STATUS.missing) return null;
		if (status[0] === KEYRING_STATUS.tooLong)
			refused("secret is larger than the 64 KiB buffer");
		if (status[0] !== KEYRING_STATUS.found) refused("secret_password_lookupv_sync");
		return value;
	};

	const remove = (service: string, account: string): boolean => {
		open();
		const status = Number(native.shim_keyring_delete(cstring(service), cstring(account)) ?? 0);
		if (status < 0) refused("secret_password_clearv_sync");
		return status === 1;
	};

	return { platform: "linux", set, get, delete: remove };
}
