/**
 * The `Security.framework` unit for `crust:keychain`, and the thin shim over its four exports. Split
 * from `keychain.ts` when that file passed the 200-line cap; the adapter imports both.
 *
 * `SecItemUpdate` then `SecItemAdd` rather than Butter's delete-then-add: a delete that lands before
 * a failing add loses the credential outright. Nothing here shells out — `security
 * add-generic-password -w …` puts the secret in the process list, which is the shape Butter has.
 */

import { cc, FFIType, ptr } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import keychainA from "./shim/118_keychain_a.c" with { type: "text" };
import keychainB from "./shim/119_keychain_b.c" with { type: "text" };

/** One unit: the second part uses the first's `kc_*` statics, so the join is load-bearing. */
const UNIT_SOURCE = `${keychainA}\n${keychainB}`;

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;

/** The status the C half answers with, as one table the TypeScript half reads. */
export const KEYCHAIN_STATUS = {
	/** Worked, or an entry was removed. */
	ok: 0,
	/** The store refused, or nothing is stored. */
	refused: -1,
	/** A name was empty or NUL-bearing. */
	badName: -2,
	/** A CoreFoundation object could not be built. */
	noMemory: -3,
} as const;

/** The five exports, as `bun:ffi` hands them back. */
export interface KeychainUnit {
	symbols: {
		shim_keychain_available: () => number;
		shim_keychain_set: (
			service: number,
			serviceLength: number,
			account: number,
			accountLength: number,
			secret: number,
			secretLength: number,
		) => number;
		shim_keychain_get: (
			service: number,
			serviceLength: number,
			account: number,
			accountLength: number,
			dst: number,
			capacity: number,
		) => number;
		shim_keychain_delete: (
			service: number,
			serviceLength: number,
			account: number,
			accountLength: number,
		) => number;
		shim_keychain_list: (
			service: number,
			serviceLength: number,
			dst: number,
			capacity: number,
		) => number;
	};
}

function compile(): KeychainUnit {
	/** Content-hashed, so a second launch reuses the file and TinyCC's per-path cache. */
	function sourcePath(): string {
		const hash = createHash("sha256").update(UNIT_SOURCE).digest("hex").slice(0, 16);
		const file = join(tmpdir(), `crust-keychain-${hash}.c`);
		if (!existsSync(file)) writeFileSync(file, UNIT_SOURCE);
		return file;
	}

	return cc({
		source: sourcePath(),
		flags: ["-framework", "Security", "-framework", "CoreFoundation"],
		symbols: {
			shim_keychain_available: { args: [], returns: I32 },
			shim_keychain_set: { args: [P, I64, P, I64, P, I64], returns: I32 },
			shim_keychain_get: { args: [P, I64, P, I64, P, I64], returns: I64 },
			shim_keychain_delete: { args: [P, I64, P, I64], returns: I32 },
			shim_keychain_list: { args: [P, I64, P, I64], returns: I64 },
		},
	}) as unknown as KeychainUnit;
}

let unitOnce: KeychainUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function keychainUnit(): KeychainUnit {
	return (unitOnce ??= compile());
}

/**
 * The C half, named so a test drives the adapter with a fake of the same shape. Every method
 * compiles on call, not when this object is built, so importing the adapter never builds the unit.
 */
export interface KeychainShim {
	available(): boolean;
	/** `KEYCHAIN_STATUS.ok` stored, `KEYCHAIN_STATUS.refused` on a refusal. */
	set(service: string, account: string, secret: string): number;
	/** Bytes into `into` and the full length, `refused` when nothing is stored. */
	get(service: string, account: string, into: Uint8Array): number;
	/** 1 removed, 0 nothing stored, negative refused. */
	delete(service: string, account: string): number;
	/** NUL-separated accounts into `into`, and the byte count. */
	list(service: string, into: Uint8Array): number;
}

// A strong reference for the duration of one call: `bun:ffi` reads the bytes during the call and a
// local `Uint8Array` may be collected before it returns — the device `opener.ts` uses.
let pinned: Uint8Array[] = [];

/** Encode a name and pin it. Its bytes go as address plus length, never as a terminator. */
function bytesOf(text: string): { address: number; length: number } {
	const bytes = new TextEncoder().encode(text);
	pinned.push(bytes);
	return { address: ptr(bytes), length: bytes.length };
}

/** The real shim: one call per method, buffers built here, bytes pinned for the call. */
export function darwinKeychainShim(): KeychainShim {
	const unit = () => keychainUnit().symbols;
	return {
		available: () => Number(unit().shim_keychain_available() ?? 0) === 1,
		set: (service, account, secret) => {
			pinned = [];
			const s = bytesOf(service);
			const a = bytesOf(account);
			const v = bytesOf(secret);
			return Number(
				unit().shim_keychain_set(
					s.address,
					s.length,
					a.address,
					a.length,
					v.address,
					v.length,
				) ?? -1,
			);
		},
		get: (service, account, into) => {
			pinned = [];
			const s = bytesOf(service);
			const a = bytesOf(account);
			return Number(
				unit().shim_keychain_get(
					s.address,
					s.length,
					a.address,
					a.length,
					ptr(into),
					into.length,
				) ?? -1,
			);
		},
		delete: (service, account) => {
			pinned = [];
			const s = bytesOf(service);
			const a = bytesOf(account);
			return Number(
				unit().shim_keychain_delete(s.address, s.length, a.address, a.length) ?? -1,
			);
		},
		list: (service, into) => {
			pinned = [];
			const s = bytesOf(service);
			return Number(
				unit().shim_keychain_list(s.address, s.length, ptr(into), into.length) ?? -1,
			);
		},
	};
}

/**
 * Compile the unit and report whether Security.framework serves it. Nothing is read or written, so
 * this is test-safe: it never prompts, and it needs no login session beyond the running one.
 */
export function keychainUnitStatus(): { available: boolean; reason: string } {
	try {
		const { symbols } = keychainUnit();
		if (Number(symbols.shim_keychain_available() ?? 0) === 1) {
			return { available: true, reason: "compiled" };
		}
		return {
			available: false,
			reason: "Security.framework does not answer a symbol this part sends",
		};
	} catch (error) {
		return { available: false, reason: error instanceof Error ? error.message : String(error) };
	}
}
