/**
 * `crust:updater`'s Ed25519 half: the manifest's `signature` is base64 over the artifact bytes, `pubkey` is base64 of 32 raw bytes, and WebCrypto verifies it with no dependency.
 * A signature that cannot be decoded is a failure value, never a throw, because WebCrypto raises on a wrong key or signature length.
 */

import { readString, seen, type UpdaterFailure } from "./updater-args";

export const ED25519_PUBKEY_BYTES = 32;
export const ED25519_SIGNATURE_BYTES = 64;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Raw bytes of a base64 string, or `undefined` when it is not base64 at all. The spelling must be
 * the canonical one for these bytes: Node silently drops the low bits of a dangling character, so
 * an unpadded tail would import as *some other* key without anyone noticing until verification
 * fails on a legitimate update.
 */
export function decodeBase64(value: unknown): Uint8Array | undefined {
	if (typeof value !== "string" || !BASE64.test(value)) return undefined;
	const bytes = new Uint8Array(Buffer.from(value, "base64"));
	if (bytes.length === 0 || Buffer.from(bytes).toString("base64") !== value) return undefined;
	return bytes;
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
 * `pinned` is the plugin's configured key and the only key a signature is ever verified with: a
 * manifest's own `pubkey` may only name that key, so a page cannot certify itself with a key it
 * shipped. With no pinned key there is nothing to verify against, and that is `null`, never the
 * caller's key.
 */
export function readSignatureArgs(
	source: unknown,
	pinned?: string,
): SignatureArgs | null | undefined {
	const signature = readString(source, "signature");
	if (signature === undefined) return undefined;
	if (pinned === undefined) return null;
	const given = readString(source, "pubkey");
	if (given !== undefined && !samePubkey(given, pinned)) return null;
	return { signature, pubkey: pinned };
}

/** Two keys are the same when their 32 bytes are, not when their base64 text happens to match. */
export function samePubkey(left: string, right: string): boolean {
	const a = decodeBase64(left);
	const b = decodeBase64(right);
	if (a?.length !== ED25519_PUBKEY_BYTES || b?.length !== ED25519_PUBKEY_BYTES) return false;
	return Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
}

/** A signature with no configured key is refused by name: the page's own key is never accepted. */
export function requiresPubkey(args: unknown): UpdaterFailure {
	const message =
		"crust: updater.download requires updater.pubkey in crust.config.ts to verify a signature, " +
		`and this app pins none, got ${seen(args)}`;
	return { ok: false, code: "invalid-arguments", message, requires: "updater.pubkey" };
}

/**
 * A pinned key makes a signature mandatory: the digest alone is attacker-chosen when the update
 * server answers both halves. The refusal is a typed answer with `requires`, never a throw.
 */
export function requiresSignature(args: unknown): UpdaterFailure {
	const message =
		"crust: updater.download requires a signature because this app pins updater.pubkey; " +
		"an artifact with only a digest is not verified, got " +
		seen(args);
	return { ok: false, code: "invalid-arguments", message, requires: "signature" };
}

/** Nothing is installed from an artifact whose bytes are not the ones the manifest signed. */
export function signatureMismatch(path: string): UpdaterFailure {
	const message = "crust: updater.download: the artifact does not match the manifest signature";
	return { ok: false, code: "signature-mismatch", message, path };
}
