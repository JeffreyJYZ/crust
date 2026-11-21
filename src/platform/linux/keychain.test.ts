/**
 * The Linux keychain adapter. The real success path needs a session bus, a Secret Service provider
 * and libsecret, none of which exist on this Mac, so these pin the shape and the absence path: a
 * missing library becomes a clean refusal that tells the user exactly what to install, and every
 * status the C shim can write is mapped without inventing a secret.
 */

import { describe, expect, test } from "bun:test";
import {
	KEYRING_INSTALL_LINE,
	KEYRING_STATUS,
	type LinuxKeychainNative,
	linuxKeychainAdapter,
} from "./keychain.ts";

/** A native half that refuses to open, recording what the error text said. */
function absentNative(): LinuxKeychainNative & { opens: number } {
	return {
		opens: 0,
		shim_keyring_open() {
			this.opens++;
			return 0;
		},
		shim_lib_error_text: () => "cannot load libsecret-1.so.0",
		shim_keyring_set: () => 0,
		shim_keyring_get: () => null,
		shim_keyring_delete: () => -1,
	};
}

/** A native half that opens and answers from a small in-memory store. */
function presentNative(status: number = KEYRING_STATUS.found, value: string | null = "s3cret") {
	return {
		opens: 0,
		shim_keyring_open() {
			this.opens++;
			return 1;
		},
		shim_lib_error_text: () => "",
		shim_keyring_set: () => 1,
		shim_keyring_get: (_service: Uint8Array, _account: Uint8Array, out: Int32Array) => {
			out[0] = status;
			return value;
		},
		shim_keyring_delete: () => 1,
	};
}

describe("linux keychain absence", () => {
	test("a missing library throws a refusal naming libsecret and the package", () => {
		const native = absentNative();
		const adapter = linuxKeychainAdapter(native);
		expect(() => adapter.set("app", "token", "s3cret")).toThrow(/libsecret/);
		try {
			adapter.set("app", "token", "s3cret");
		} catch (error) {
			const message = String(error);
			expect(message).toContain("libsecret-1.so.0");
			expect(message).toContain("libsecret-1-0");
			expect(message).toContain("gnome-keyring");
			expect(message).toContain(KEYRING_INSTALL_LINE);
		}
	});

	test("every command refuses cleanly and retries resolution on the next command", () => {
		const native = absentNative();
		const adapter = linuxKeychainAdapter(native);
		expect(() => adapter.get("app", "token")).toThrow(/libsecret/);
		expect(() => adapter.delete("app", "token")).toThrow(/libsecret/);
		// A refused open does not latch: installing libsecret mid-session can still work later.
		expect(native.opens).toBe(2);
	});
});

describe("linux keychain status mapping", () => {
	test("a NUL-bearing secret is refused before libsecret can store a truncated prefix", () => {
		const native = presentNative();
		let writes = 0;
		native.shim_keyring_set = () => {
			writes++;
			return 1;
		};
		const adapter = linuxKeychainAdapter(native);
		expect(() => adapter.set("app", "token", "a\0b")).toThrow("NUL");
		expect(writes).toBe(0);
	});

	test("a stored secret comes back and set/delete report success", () => {
		const native = presentNative();
		const adapter = linuxKeychainAdapter(native);
		expect(() => adapter.set("app", "token", "s3cret")).not.toThrow();
		expect(adapter.get("app", "token")).toBe("s3cret");
		expect(adapter.delete("app", "token")).toBe(true);
	});

	test("a missing credential is null, never a thrown refusal", () => {
		const adapter = linuxKeychainAdapter(presentNative(KEYRING_STATUS.missing, null));
		expect(adapter.get("app", "token")).toBeNull();
	});

	test("a refused or oversized read throws with the install line", () => {
		for (const status of [KEYRING_STATUS.refused, KEYRING_STATUS.tooLong]) {
			const adapter = linuxKeychainAdapter(presentNative(status, null));
			expect(() => adapter.get("app", "token")).toThrow(/libsecret/);
		}
	});

	test("a delete that found nothing returns false", () => {
		const native = presentNative();
		native.shim_keyring_delete = () => 0;
		expect(linuxKeychainAdapter(native).delete("app", "token")).toBe(false);
	});
});
