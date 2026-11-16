/**
 * The fake dock adapter both `crust:dock` suites use, so a contract change is one edit and a fake
 * stays a plain value — `mock.fn` does not exist in `bun:test`, and a real `NSDockTile` would badge
 * the dock of whoever is at the machine.
 */

import type { DockAdapter } from "./dock.ts";

export interface RecordedDock {
	adapter: DockAdapter;
	calls: string[];
}

/** Every command answers success and records what it was handed. */
export function fake(overrides: Partial<DockAdapter> = {}): RecordedDock {
	const calls: string[] = [];
	const adapter: DockAdapter = {
		setBadge: (label) => {
			calls.push(`setBadge:${label}`);
			return { ok: true, reason: label.length === 0 ? "badge cleared" : "badge set" };
		},
		badgeLabel: () => {
			calls.push("badgeLabel");
			return "3";
		},
		bounce: (critical) => {
			calls.push(`bounce:${critical}`);
			return { ok: true, request: critical ? 7 : 6, reason: "bounced" };
		},
		setProgress: (value) => {
			calls.push(`setProgress:${value}`);
			return { ok: true, reason: "progress set" };
		},
		...overrides,
	};
	return { adapter, calls };
}

/** The thrown error, or undefined when nothing was thrown. */
export async function thrown(run: () => Promise<unknown>): Promise<unknown> {
	try {
		await run();
		return undefined;
	} catch (error) {
		return error;
	}
}
