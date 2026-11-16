/**
 * `stronghold`'s crypto half. PBKDF2-SHA256 (600 000 iterations over a 16-byte random salt) turns the password into one
 * 32-byte secret, used twice: as the AES-256-GCM key that seals every name and value, and as the HMAC-SHA256 key that
 * indexes an entry, so the file reveals neither a key name nor its equality pattern. The salt lives in the header so a
 * reopen derives the same key, and the header also holds one sealed marker — that marker is how a wrong password is told
 * from an empty store, because GCM authentication fails on the wrong key instead of decrypting to noise.
 */

import {
	fromBase64,
	IV_BYTES,
	KDF_ITERATIONS,
	KDF_MIN_ITERATIONS,
	KDF_NAME,
	KEY_BITS,
	SALT_BYTES,
	STORE_VERSION,
	toBase64,
} from "./stronghold-file.ts";
import {
	failure,
	reasonOf,
	type DerivedKeys,
	type OpenedStore,
	type Sealed,
	type StrongholdFailure,
	type StrongholdFile,
} from "./stronghold-types.ts";

/** The sealed constant the header carries; a wrong password cannot reproduce it. */
const MARKER = "crust:stronghold:v1";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function deriveKeys(
	password: string,
	salt: Uint8Array,
	iterations: number,
): Promise<DerivedKeys> {
	const material = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt), iterations },
		material,
		KEY_BITS,
	);
	const raw = new Uint8Array(bits);
	const aes = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
		"encrypt",
		"decrypt",
	]);
	const mac = await crypto.subtle.importKey(
		"raw",
		raw,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return { aes, mac };
}

/** A fresh 12-byte IV per call: reusing one under the same key would break GCM outright. */
export async function seal(aes: CryptoKey, plaintext: string): Promise<Sealed> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const data = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		aes,
		encoder.encode(plaintext),
	);
	return { iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
}

/** `undefined` means the bytes did not authenticate: a wrong key, or a tampered ciphertext. */
export async function unseal(aes: CryptoKey, sealed: Sealed): Promise<string | undefined> {
	try {
		const iv = fromBase64(sealed.iv);
		if (iv.length !== IV_BYTES) return undefined;
		const plain = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv },
			aes,
			fromBase64(sealed.data),
		);
		return decoder.decode(plain);
	} catch {
		return undefined;
	}
}

/** The entry's index: an HMAC of the name, so the file holds no name and no order either. */
export async function entryId(mac: CryptoKey, name: string): Promise<string> {
	const signature = await crypto.subtle.sign("HMAC", mac, encoder.encode(`entry:${name}`));
	return toBase64(new Uint8Array(signature));
}

/** A brand-new store: a random salt, the header's sealed marker, and no entries. */
export async function createStore(
	password: string,
	iterations: number = KDF_ITERATIONS,
): Promise<OpenedStore> {
	if (!Number.isInteger(iterations) || iterations < KDF_MIN_ITERATIONS) {
		// A header this build would refuse to read is not a store worth writing.
		throw new Error(
			`stronghold: ${iterations} PBKDF2 rounds is below the KDF floor of ${KDF_MIN_ITERATIONS}`,
		);
	}
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const keys = await deriveKeys(password, salt, iterations);
	const file: StrongholdFile = {
		version: STORE_VERSION,
		kdf: { algorithm: KDF_NAME, iterations, salt: toBase64(salt) },
		check: await seal(keys.aes, MARKER),
		entries: {},
	};
	return { file, keys };
}

/** Derive from the header's own salt and rounds, then prove the key by opening the marker. */
export async function openStore(
	file: StrongholdFile,
	password: string,
): Promise<{ ok: true; store: OpenedStore } | StrongholdFailure> {
	let keys: DerivedKeys;
	try {
		keys = await deriveKeys(password, fromBase64(file.kdf.salt), file.kdf.iterations);
	} catch (error) {
		return failure("io-error", reasonOf(error));
	}
	if ((await unseal(keys.aes, file.check)) !== MARKER) {
		return failure("bad-password", "the password does not open this store");
	}
	return { ok: true, store: { file, keys } };
}
