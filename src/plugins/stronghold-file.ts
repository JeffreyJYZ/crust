/**
 * `stronghold`'s file half: one JSON document of sealed entries under the app's data directory. A missing file is the
 * empty answer — that is the first `open` creating a store — while anything present but unreadable is `corrupt`, because
 * a half-parsed vault that reads as empty is the one answer a lock must never give. Writes are atomic and 0600.
 */

import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
	reasonOf,
	type StrongholdEntry,
	type StrongholdFile,
	type Sealed,
} from "./stronghold-types.ts";

export const KDF_NAME = "PBKDF2-SHA256";
export const KDF_ITERATIONS = 600_000;
/**
 * The fewest rounds this build will derive from. A store file is the user's own, so its header can
 * claim any count; a header below the KDF's documented parameter is refused rather than obeyed,
 * because one round is no work at all.
 */
export const KDF_MIN_ITERATIONS = KDF_ITERATIONS;
/**
 * The most rounds this build will derive from, and the other half of the same argument: `open` runs
 * on a page-triggered call, so an unbounded header is a denial of service the page can aim at its
 * own app. 5 000 000 is ~8x today's 600 000 — headroom for the hardware-driven bump a future build
 * would write (OWASP's PBKDF2-SHA256 guidance has already moved 600 000 to 1 200 000) — while the
 * worst case stays a few seconds of CPU instead of hours.
 */
export const KDF_MAX_ITERATIONS = 5_000_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const KEY_BITS = 256;
export const STORE_FILE = "stronghold.json";
export const STORE_VERSION = 1;

/** macOS's per-app data directory; `CRUST_DATA_DIR` wins, because a packaged app already knows its own root. */
export function defaultStoreRoot(app: string): string {
	const override = process.env.CRUST_DATA_DIR;
	if (override !== undefined && override.length > 0) return override;
	return join(homedir(), "Library", "Application Support", app);
}

export function toBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

/** A plain `ArrayBuffer`-backed copy, so WebCrypto accepts it without a cast. */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
	const buffer = Buffer.from(text, "base64");
	const bytes = new Uint8Array(buffer.length);
	bytes.set(buffer);
	return bytes;
}

function isSealed(value: unknown): value is Sealed {
	if (typeof value !== "object" || value === null) return false;
	const { iv, data } = value as Record<string, unknown>;
	return typeof iv === "string" && typeof data === "string" && iv.length > 0 && data.length > 0;
}

function isEntry(value: unknown): value is StrongholdEntry {
	if (typeof value !== "object" || value === null) return false;
	const { name, value: sealed } = value as Record<string, unknown>;
	return isSealed(name) && isSealed(sealed);
}

/** A file this version can read; anything else is refused before a key is ever derived from it. */
export function isStrongholdFile(value: unknown): value is StrongholdFile {
	if (typeof value !== "object" || value === null) return false;
	const { version, kdf, check, entries } = value as Record<string, unknown>;
	if (version !== STORE_VERSION || !isSealed(check)) return false;
	if (typeof kdf !== "object" || kdf === null) return false;
	const { algorithm, iterations, salt } = kdf as Record<string, unknown>;
	if (algorithm !== KDF_NAME) return false;
	if (
		typeof iterations !== "number" ||
		!Number.isInteger(iterations) ||
		iterations < KDF_MIN_ITERATIONS ||
		iterations > KDF_MAX_ITERATIONS
	) {
		return false;
	}
	if (typeof salt !== "string" || fromBase64(salt).length !== SALT_BYTES) return false;
	if (typeof entries !== "object" || entries === null) return false;
	return Object.values(entries).every(isEntry);
}

/**
 * The sentence naming the bound a round count breaks, or `undefined` when it is inside both. Only
 * used to name the refusal: an out-of-band header is `corrupt` either way, and the reader says which
 * number it objected to instead of "not a store". Both halves answer it, so they cannot drift.
 */
export function kdfRefusal(iterations: number): string | undefined {
	if (iterations < KDF_MIN_ITERATIONS) {
		return `is below the KDF floor of ${KDF_MIN_ITERATIONS}`;
	}
	if (iterations > KDF_MAX_ITERATIONS) {
		return `is above the KDF ceiling of ${KDF_MAX_ITERATIONS}`;
	}
	return undefined;
}

/** The rounds a parsed object claims, when it claims a count this build will not derive from. */
function refusedIterations(value: unknown): number | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const { kdf } = value as { kdf?: unknown };
	if (typeof kdf !== "object" || kdf === null) return undefined;
	const { iterations } = kdf as { iterations?: unknown };
	if (typeof iterations !== "number" || !Number.isInteger(iterations)) return undefined;
	return kdfRefusal(iterations) === undefined ? undefined : iterations;
}

export type StoreRead =
	| { ok: true; file?: StrongholdFile }
	| { ok: false; code: "corrupt" | "io-error"; message: string };

export async function readStore(path: string): Promise<StoreRead> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return { ok: true };
		return { ok: false, code: "io-error", message: reasonOf(error) };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { ok: false, code: "corrupt", message: `${path} is not JSON` };
	}
	if (!isStrongholdFile(parsed)) {
		const claimed = refusedIterations(parsed);
		if (claimed !== undefined) {
			return {
				ok: false,
				code: "corrupt",
				message: `${path} asks for ${claimed} PBKDF2 rounds, which ${kdfRefusal(claimed)}`,
			};
		}
		return { ok: false, code: "corrupt", message: `${path} is not a stronghold store` };
	}
	return { ok: true, file: parsed };
}

/**
 * Write a temporary file in the same directory, then rename: a crash mid-write leaves the previous store intact rather
 * than a truncated one that would read as `corrupt`. The `chmod` is not redundant — the mode argument applies only when
 * the temporary file is created, and the rename carries whatever mode it ended up with.
 */
export async function writeStore(path: string, file: StrongholdFile): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(file, null, "\t")}\n`, { mode: 0o600 });
		await chmod(temporary, 0o600);
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}
