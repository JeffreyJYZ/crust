/**
 * macOS crash unit: the signal handlers that write the record, and nothing else. The C half is its own translation unit (`shim/111_crash.c`), because a fault handler must not share a unit with code that can be mid-send when the fault lands.
 * What is armed here is only half the story: the handler writes a fixed record and exits, and `runtime-crash-guard.ts` is the second process that reads it. A reporter inside the crashing process cannot be trusted to finish, so this side refuses to try.
 */

import { cc, FFIType, ptr } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A compiled binary has no readable `import.meta.dir`, so the C unit travels inside the binary as
// text and is materialised before `cc()` sees it — the device `opener.ts` uses.
import crashPart from "./shim/111_crash.c" with { type: "text" };
import installPart from "./shim/112_crash_install.c" with { type: "text" };

/** The two halves as one translation unit: the second installs the first's handlers. */
export const crashSource = [crashPart, installPart].join("\n");

/**
 * `crust_crash_arm`'s answer. `armed` and `alreadyArmed` both leave handlers installed; the
 * difference is only whether this call did it.
 */
export const CRASH_STATUS = {
	armed: 0,
	alreadyArmed: 1,
	refusedPath: 2,
	refusedSignal: 3,
} as const;

export interface CrashArm {
	/** True whenever handlers are installed after this call, including a no-op re-arm. */
	armed: boolean;
	/** One of `CRASH_STATUS`, or -1 when the unit did not compile. */
	status: number;
	/** Why, including which step refused it. */
	reason: string;
	/** The record path, present when a call had one. */
	record?: string;
}

/** The exports, as `bun:ffi` hands them back. */
export interface CrashUnit {
	symbols: {
		crust_crash_arm: (bytes: number, length: number) => number;
		crust_crash_disarm: () => number;
		crust_crash_armed: () => number;
		crust_crash_reason: () => string | null;
	};
}

function compile(): CrashUnit {
	/** Content-hashed, so a second launch reuses the file and TinyCC's cache. */
	function sourcePath(): string {
		const hash = createHash("sha256").update(crashSource).digest("hex").slice(0, 16);
		const file = join(tmpdir(), `crust-crash-${hash}.c`);
		if (!existsSync(file)) writeFileSync(file, crashSource);
		return file;
	}

	return cc({
		source: sourcePath(),
		symbols: {
			crust_crash_arm: { args: [FFIType.ptr, FFIType.i64], returns: FFIType.i32 },
			crust_crash_disarm: { args: [], returns: FFIType.i32 },
			crust_crash_armed: { args: [], returns: FFIType.i32 },
			crust_crash_reason: { args: [], returns: FFIType.cstring },
		},
	}) as unknown as CrashUnit;
}

let unitOnce: CrashUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function unit(): CrashUnit {
	return (unitOnce ??= compile());
}

/** Compile the unit and report whether every export resolved. Nothing is armed. */
export function crashUnitStatus(): { available: boolean; reason: string } {
	try {
		unit();
		return { available: true, reason: "compiled" };
	} catch (error) {
		return { available: false, reason: message(error) };
	}
}

// A strong reference for the duration of one call: `bun:ffi` reads the bytes during the call, and
// a local `Uint8Array` may be collected before it returns.
let pinned: Uint8Array | undefined;

function bytesOf(text: string): { address: number; length: number } {
	const bytes = new TextEncoder().encode(text);
	pinned = bytes;
	return { address: ptr(bytes), length: bytes.length };
}

function reasonOf(compiled: CrashUnit, fallback: string): string {
	const reason = String(compiled.symbols.crust_crash_reason() ?? "");
	return reason.length > 0 ? reason : fallback;
}

/**
 * Install handlers for SIGSEGV, SIGBUS, SIGILL, SIGFPE and SIGABRT that write `recordPath` and
 * `_exit(70)`. The record is truncated here, so an old crash can never be read as this one's.
 */
export function armCrashHandlers(recordPath: string): CrashArm {
	if (typeof recordPath !== "string" || recordPath.length === 0) {
		return {
			armed: false,
			status: CRASH_STATUS.refusedPath,
			reason: "the record path is empty",
		};
	}
	let compiled: CrashUnit;
	try {
		compiled = unit();
	} catch (error) {
		return {
			armed: false,
			status: -1,
			reason: `the crash C unit did not compile: ${message(error)}`,
			record: recordPath,
		};
	}
	const { address, length } = bytesOf(recordPath);
	const status = Number(compiled.symbols.crust_crash_arm(address, length) ?? -1);
	const armed = status === CRASH_STATUS.armed || status === CRASH_STATUS.alreadyArmed;
	return {
		armed,
		status,
		reason: reasonOf(compiled, `status ${status} with no recorded reason`),
		record: recordPath,
	};
}

/** Restore the default disposition and close the record descriptor. */
export function disarmCrashHandlers(): CrashArm {
	let compiled: CrashUnit;
	try {
		compiled = unit();
	} catch (error) {
		return {
			armed: false,
			status: -1,
			reason: `the crash C unit did not compile: ${message(error)}`,
		};
	}
	// The C unit answers the signal it could not clear, so a partial disarm is visible here
	// instead of reported as "fully restored" — the caller is told which handler still lives.
	const status = Number(compiled.symbols.crust_crash_disarm() ?? 0);
	return {
		armed: crashArmed(),
		status,
		reason: reasonOf(
			compiled,
			status === 0 ? "disarmed" : `crust_crash_disarm answered ${status}`,
		),
	};
}

/** Whether this process currently has handlers installed. */
export function crashArmed(): boolean {
	try {
		return Number(unit().symbols.crust_crash_armed() ?? 0) === 1;
	} catch {
		return false;
	}
}

/**
 * The native half `crust:crash-reporter` takes structurally, so a runtime wires it in one line:
 * `createCrashReporterPlugin({ root, guard, native: darwinCrashAdapter() })`.
 */
export function darwinCrashAdapter(): {
	arm(recordPath: string): CrashArm;
	disarm(): CrashArm;
} {
	return { arm: armCrashHandlers, disarm: disarmCrashHandlers };
}

export function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
