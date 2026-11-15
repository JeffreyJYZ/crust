/**
 * The JSON an update endpoint answers, read strictly: a manifest half-read would download the wrong file, so every unknown field shape is refused with the reason.
 * Nothing here touches the network or a filesystem, so the parse is testable on its own.
 */

import { isEd25519Pubkey, isSignature, readSignatureArgs } from "./updater-signature";
import { isSha256Hex, readString, seen, type UpdateManifest } from "./updater-args";

export function parseManifest(
	value: unknown,
): { ok: true; manifest: UpdateManifest } | { ok: false; reason: string } {
	const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return fail(`a manifest must be a JSON object, got ${seen(value)}`);
	}
	const source = value as Record<string, unknown>;
	const version = readString(source, "version");
	if (version === undefined) return fail('a manifest needs "version" as a non-empty string');
	const url = readString(source, "url");
	if (url === undefined) return fail('a manifest needs "url" as a non-empty string');
	const manifest: UpdateManifest = { version, url };
	if (source.notes !== undefined) {
		if (typeof source.notes !== "string") return fail('"notes" must be a string when present');
		manifest.notes = source.notes;
	}
	if (source.sha256 !== undefined) {
		if (!isSha256Hex(source.sha256)) return fail('"sha256" must be 64 hex characters');
		manifest.sha256 = source.sha256.toLowerCase();
	}
	if (source.signature !== undefined || source.pubkey !== undefined) {
		if (!isSignature(source.signature)) return fail('"signature" must be base64 Ed25519');
		if (!isEd25519Pubkey(source.pubkey)) return fail('"pubkey" must be base64 of 32 bytes');
		const signed = readSignatureArgs(source);
		if (signed === null || signed === undefined) return fail('"signature" needs a "pubkey"');
		manifest.signature = signed.signature;
		manifest.pubkey = signed.pubkey;
	}
	return { ok: true, manifest };
}
