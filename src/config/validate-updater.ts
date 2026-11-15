import type { Validator } from "./validator.ts";

export const UPDATER_KEYS = ["endpoint", "pubkey", "autoCheck"] as const;

/** Base64 of 32 raw bytes: 43 characters, or 44 with the one padding byte. */
const BASE64_32 = /^[A-Za-z0-9+/]{43}=?$/;

/**
 * The `pubkey` is checked by shape here and by length in the regex, because a 31-byte key would
 * import as a key of the wrong size and fail every signature at run time instead of at startup.
 */
export function validateUpdater(v: Validator, value: unknown): void {
	if (value === undefined) return;
	const updater = v.object("updater", value);
	if (!updater) return;
	v.only(updater, "updater", UPDATER_KEYS);
	v.string(updater, "endpoint", "updater", false);

	const pubkey = updater.pubkey;
	if (pubkey !== undefined && (typeof pubkey !== "string" || !BASE64_32.test(pubkey))) {
		v.fail("updater.pubkey", "base64 of 32 raw bytes", pubkey);
	}

	const autoCheck = updater.autoCheck;
	if (autoCheck !== undefined && typeof autoCheck !== "boolean") {
		v.fail("updater.autoCheck", "a boolean", autoCheck);
	}
}
