/**
 * `crust:updater`'s Ed25519 half: the manifest's `signature` is base64 over the artifact bytes, `pubkey` is base64 of 32 raw bytes, and WebCrypto verifies it with no dependency.
 * A signature that cannot be decoded is a failure value, never a throw, because WebCrypto raises on a wrong key or signature length.
 */

import { readString, type UpdaterFailure } from "./updater-args";

export const ED25519_PUBKEY_BYTES = 32;
export const ED25519_SIGNATURE_BYTES = 64;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Raw bytes of a base64 string, or `undefined` when it is not base64 at all. */
export function decodeBase64(value: unknown): Uint8Array | undefined {
	if (typeof value !== "string" || !BASE64.test(value)) return undefined;
	const bytes = new Uint8Array(Buffer.from(value, "base64"));
	return bytes.length > 0 ? bytes : undefined;
}

/** A `pubkey` is base64 of exactly 32 raw bytes; anything else cannot be an Ed25519 key. */
export function isEd25519Pubkey(value: unknown): boolean {
	return decodeBase64(value)?.length === ED25519_PUBKEY_BYTES;
}

/** A `signature` is base64 of exactly 64 raw bytes; a shorter one can never verify. */
export function isSignature(value: unknown): boolean {
	return decodeBase64(value)?.length === ED25519_SIGNATURE_BYTES;
}

/** True only when `signature` is Ed25519 over exactly these bytes by the private half of `pubkey`. */
export async function verifyEd25519(
	pubkey: string,
	signature: string,
	bytes: Uint8Array,
): Promise<boolean> {
	const key = decodeBase64(pubkey);
	const signed = decodeBase64(signature);
	if (key === undefined || key.length !== ED25519_PUBKEY_BYTES || signed === undefined) {
		return false;
	}
	try {
		const subtle = globalThis.crypto.subtle;
		const imported = await subtle.importKey(
			"raw",
			new Uint8Array(key),
			{ name: "Ed25519" },
			false,
			["verify"],
		);
		return await subtle.verify(
			{ name: "Ed25519" },
			imported,
			new Uint8Array(signed),
			new Uint8Array(bytes),
		);
	} catch {
		return false;
	}
}

/** Both halves of a signature check, read off a `download` argument or a manifest. */
export interface SignatureArgs {
	readonly signature: string;
	readonly pubkey: string;
}

/**
 * Both or neither: `undefined` means no signature was claimed, `null` means the claim is unusable.
 * `pinned` is the plugin's configured key, so a page may leave `pubkey` out and still be held to
 * the key the app shipped with — and may never substitute one of its own.
 */
export function readSignatureArgs(
	source: unknown,
	pinned?: string,
): SignatureArgs | null | undefined {
	const signature = readString(source, "signature");
	const given = readString(source, "pubkey");
	if (given !== undefined && pinned !== undefined && given !== pinned) return null;
	const pubkey = given ?? pinned;
	if (signature === undefined) return undefined;
	if (pubkey === undefined) return null;
	return { signature, pubkey };
}

/** Nothing is installed from an artifact whose bytes are not the ones the manifest signed. */
export function signatureMismatch(path: string): UpdaterFailure {
	const message = "crust: updater.download: the artifact does not match the manifest signature";
	return { ok: false, code: "signature-mismatch", message, path };
}
