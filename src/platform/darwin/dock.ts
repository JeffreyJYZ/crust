/**
 * The macOS dock tile behind `crust:dock`: `NSApplication`'s `dockTile`, its badge label, the
 * attention bounce and a progress bar. The C boundary is `dock-ffi.ts`; this file is the adapter the
 * plugin takes structurally, so it owns no AppKit and no symbol.
 * Progress is built, installed and updated inside C, so the dock tile's content view never becomes a
 * value this process holds, and a bar that could not be installed answers a refusal with the C
 * reason instead of a fake success.
 */

import { bytesOf, dockUnit, type DockUnit } from "./dock-ffi.ts";

export { bytesOf, DOCK_SYMBOL_NAMES, dockSource, dockUnit, dockUnitStatus } from "./dock-ffi.ts";
export type { DockUnit } from "./dock-ffi.ts";

/** What one dock call reports: the OS's own answer plus the step that produced it. */
export interface DockOutcome {
	ok: boolean;
	reason: string;
}

/** A bounce answers the request id AppKit minted; `ok: false` means AppKit was unreachable. */
export interface DockBounce extends DockOutcome {
	request: number;
}

/** The native half as this module hands it out; `crust:dock` takes it structurally. */
export interface DarwinDockAdapter {
	setBadge(label: string): DockOutcome;
	badgeLabel(): string;
	bounce(critical: boolean): DockBounce;
	setProgress(value: number): DockOutcome;
}

const message = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** The unit, or the reason it could not be compiled — a compile failure is a refusal, not a throw. */
function compiled(): DockUnit | string {
	try {
		return dockUnit();
	} catch (error) {
		return `the dock C unit did not compile: ${message(error)}`;
	}
}

/** The C unit's own reason, so a refusal names the step instead of a status number. */
function reasonOf(unit: DockUnit, fallback: string): string {
	const reason = String(unit.symbols.crust_dock_reason() ?? "");
	return reason.length > 0 ? reason : fallback;
}

/** One badge send. An empty label clears the badge, which is how `-setBadgeLabel:` does it. */
function badge(label: string): DockOutcome {
	const unit = compiled();
	if (typeof unit === "string") return { ok: false, reason: unit };
	const { address, length } = bytesOf(label);
	const applied = Number(unit.symbols.crust_dock_set_badge(address, length) ?? 0) === 1;
	return { ok: applied, reason: reasonOf(unit, "setBadgeLabel: answered") };
}

/**
 * The native half of `crust:dock`. `badgeLabel` answers the empty string when no tile or no badge
 * exists, which is what AppKit reports, and `setProgress` answers a refusal rather than a fake
 * success when the indicator could not be built.
 */
export function darwinDockAdapter(): DarwinDockAdapter {
	return {
		setBadge: (label) => badge(label),
		badgeLabel: () => {
			const unit = compiled();
			if (typeof unit === "string") return "";
			return String(unit.symbols.crust_dock_badge_label() ?? "");
		},
		bounce: (critical) => {
			const unit = compiled();
			if (typeof unit === "string") return { ok: false, request: 0, reason: unit };
			const request = Number(unit.symbols.crust_dock_bounce(critical ? 1 : 0) ?? -1);
			// A request id of 0 is a real id, so the sentinel for "AppKit was unreachable" is -1.
			const ok = request >= 0;
			return {
				ok,
				request: ok ? request : 0,
				reason: reasonOf(unit, ok ? "bounce requested" : "requestUserAttention: refused"),
			};
		},
		setProgress: (value) => {
			const unit = compiled();
			if (typeof unit === "string") return { ok: false, reason: unit };
			const applied = Number(unit.symbols.crust_dock_set_progress(value) ?? 0) === 1;
			return { ok: applied, reason: reasonOf(unit, "setDoubleValue: answered") };
		},
	};
}
