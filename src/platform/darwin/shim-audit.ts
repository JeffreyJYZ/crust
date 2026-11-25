/**
 * Opt-in ownership audit for the macOS C shim. Every audited unit is the SAME C
 * source the product compiles: the shared prelude is prepended on both paths, and
 * only `CRUST_SHIM_AUDIT` turns the counters on. With it off the wrappers expand to
 * the exact retain/release calls they replace — no branch, no counter, no extra send.
 *
 * Enable with `CRUST_SHIM_AUDIT=1` in `crust dev` or the e2e harness. A shipped app
 * cannot: the flag is refused once NODE_ENV is production, or when the C sources are
 * not on disk (a compiled binary carries them as text under /$bunfs/root).
 */

import { FFIType } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";
import prelude from "./shim/00_audit.c" with { type: "text" };

/** The single TinyCC define that switches the counters on. */
export const AUDIT_DEFINE = "-DCRUST_SHIM_AUDIT";
/** -1 is the C-side "not instrumented" sentinel, never a count. */
export const AUDIT_DISABLED = -1;

export interface AuditSymbols {
	shim_audit_balance: () => number;
	shim_audit_events: () => number;
	shim_audit_reset: () => void;
	/** Test-only: force one imbalance to prove the report refuses it. */
	shim_audit_bump: (by: number) => void;
}

/** The same table is declared in every audited unit; arity.test.ts checks it against C. */
export const auditSymbols = {
	shim_audit_balance: { args: [], returns: FFIType.i32 },
	shim_audit_events: { args: [], returns: FFIType.i32 },
	shim_audit_reset: { args: [], returns: FFIType.void },
	shim_audit_bump: { args: [FFIType.i32], returns: FFIType.void },
} as const;

let requested = false;

/** A compiled app has no source tree; that and production mode both refuse the flag. */
export function shimAuditAvailable(): boolean {
	if (process.env.NODE_ENV === "production") return false;
	return existsSync(join(import.meta.dir, "shim", "10_prelude.c"));
}

/**
 * Ask for an instrumented build. Returns false when refused, so a caller can say so
 * instead of silently reading a -1 sentinel as a clean report.
 */
export function requestShimAudit(): boolean {
	if (!shimAuditAvailable()) return false;
	requested = true;
	return true;
}

export function shimAuditEnabled(): boolean {
	return requested || process.env.CRUST_SHIM_AUDIT === "1" ? shimAuditAvailable() : false;
}

/** Extra TinyCC flags: none when off, exactly one define when on. */
export function auditFlags(): string[] {
	return shimAuditEnabled() ? [AUDIT_DEFINE] : [];
}

/** The prelude is always present, so an off build compiles the same wrapper sites. */
export function auditSource(source: string): string {
	return `${prelude}\n${source}`;
}

/** The audit symbols are always exported; a unit's own interface need not list them. */
export function auditOf(symbols: object): AuditSymbols {
	return symbols as AuditSymbols;
}

export interface UnitReport {
	/** net owned references: +1 acquisitions minus -1 drops. */
	balance: number;
	/** acquisitions seen, so a zero with no events cannot masquerade as proof. */
	events: number;
}

export type AuditReport = Record<string, UnitReport>;

/** Read every unit; a unit compiled without the flag is reported as unavailable. */
export function readAudit(units: Record<string, AuditSymbols>): AuditReport {
	const out: AuditReport = {};
	for (const [name, symbols] of Object.entries(units)) {
		const balance = Number(symbols.shim_audit_balance());
		const events = Number(symbols.shim_audit_events());
		out[name] =
			balance === AUDIT_DISABLED || events === AUDIT_DISABLED
				? { balance: AUDIT_DISABLED, events: AUDIT_DISABLED }
				: { balance, events };
	}
	return out;
}

export function auditReset(units: Record<string, AuditSymbols>): void {
	for (const symbols of Object.values(units)) symbols.shim_audit_reset();
}

/** The verdict a test asserts: every unit instrumented, exercised, and back to zero. */
export function balanced(
	report: AuditReport,
	minimumEvents: Record<string, number> = {},
): string[] {
	const faults: string[] = [];
	for (const [name, unit] of Object.entries(report)) {
		if (unit.balance === AUDIT_DISABLED) {
			faults.push(`${name}: not compiled with ${AUDIT_DEFINE}`);
			continue;
		}
		if (unit.balance !== 0) faults.push(`${name}: balance ${unit.balance}, expected 0`);
		const minimum = minimumEvents[name] ?? 1;
		if (unit.events < minimum) {
			faults.push(`${name}: ${unit.events} ownership events, expected at least ${minimum}`);
		}
	}
	return faults;
}
