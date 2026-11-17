/**
 * The `advapi32` credential-store unit for `crust:keychain` on Windows, and the thin shim over its four
 * exports. Split from `keychain.ts` when that file reached the 200-line cap; the adapter imports both.
 *
 * `CredWriteW`/`CredReadW`/`CredDeleteW` are resolved at runtime through `LoadLibraryA` +
 * `GetProcAddress` like every other Windows entry point: TinyCC's PE import thunk jumps to -1 on
 * Windows x64 (2026-11-16). The unit is its own translation unit (`shim/48_keychain.c`), not part of
 * the window shim, so this moves neither that unit's declared-pointer count nor its module list.
 */

import { cc, FFIType, ptr } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import keychainSource from "./shim/48_keychain.c" with { type: "text" };

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;

/** The four exports, as `bun:ffi` hands them back. */
export interface WindowsKeychainUnit {
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
	};
}

/** The status the C half answers with, as one table the TypeScript half reads. */
export const WINDOWS_KEYCHAIN_STATUS = {
	ok: 0,
	/** The store refused, or nothing is stored. */
	refused: -1,
	/** A name was empty or too long. */
	badName: -2,
} as const;

function compile(): WindowsKeychainUnit {
	/** Content-hashed, so a second launch reuses the file and TinyCC's per-path cache. */
	function sourcePath(): string {
		const hash = createHash("sha256").update(keychainSource).digest("hex").slice(0, 16);
		const file = join(tmpdir(), `crust-win-keychain-${hash}.c`);
		if (!existsSync(file)) writeFileSync(file, keychainSource);
		return file;
	}

	// No `library:` and no `flags:` — the unit resolves advapi32 itself, and a PE import thunk is
	// the defect this design removed. The `symbols: {` map keeps the shape `ffi.ts` uses.
	const library = cc({
		source: sourcePath(),
		symbols: {
			shim_keychain_available: { args: [], returns: I32 },
			shim_keychain_set: { args: [P, I64, P, I64, P, I64], returns: I32 },
			shim_keychain_get: { args: [P, I64, P, I64, P, I64], returns: I64 },
			shim_keychain_delete: { args: [P, I64, P, I64], returns: I32 },
		},
	});
	return { symbols: library.symbols } as unknown as WindowsKeychainUnit;
}

let unitOnce: WindowsKeychainUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function windowsKeychainUnit(): WindowsKeychainUnit {
	return (unitOnce ??= compile());
}

/**
 * The C half, named so a test drives the adapter with a fake of the same shape — the same seam
 * `keychain-ffi.ts` gives macOS, so both platforms are proven without their OS.
 */
export interface WindowsKeychainShim {
	available(): boolean;
	set(service: string, account: string, secret: string): number;
	get(service: string, account: string, into: Uint8Array): number;
	delete(service: string, account: string): number;
}

// A strong reference for the duration of one call: `bun:ffi` reads the bytes during the call and a
// local `Uint8Array` may be collected before it returns.
let pinned: Uint8Array[] = [];

function bytesOf(text: string): { address: number; length: number } {
	const bytes = new TextEncoder().encode(text);
	pinned.push(bytes);
	return { address: ptr(bytes), length: bytes.length };
}

/** The real shim: one call per method, buffers built here, bytes pinned for the call. */
export function windowsKeychainShim(): WindowsKeychainShim {
	const unit = () => windowsKeychainUnit().symbols;
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
	};
}
