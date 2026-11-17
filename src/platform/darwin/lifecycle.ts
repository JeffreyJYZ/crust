/**
 * The macOS lifecycle source: decode the bits the app delegate recorded into
 * AppEvent names, and acknowledge a deferred `before-quit`. The delegate is the
 * one deep-link already installs (`shim/95_deeplink.c`), so this adds no object
 * and no second compile — it only drains what that delegate wrote.
 */
import type { AppEvent, LifecycleSource } from "@/app-types.ts";
import { deepLinkUnit } from "./deep-link-unit.ts";

/**
 * The lifecycle half of the deep-link C unit. The delegate is installed by
 * `installDeepLinkHandler`, so `take`/`settle` only read and acknowledge bits
 * that delegate recorded — no second compile and no second delegate object.
 */
export interface LifecycleShim {
	/** The event bitmask recorded since the last drain. */
	take(): number;
	/** 1 when a deferred terminate was answered, 0 when none was pending. */
	settle(): number;
	/** Tell the C half this process is quitting on its own terms, so a later terminate is immediate. */
	immediate?(): void;
}

/** The real lifecycle shim over the deep-link C unit. */
export function darwinLifecycleShim(): LifecycleShim {
	return {
		take: () => Number(deepLinkUnit().symbols.crust_lifecycle_take() ?? 0),
		settle: () => Number(deepLinkUnit().symbols.crust_lifecycle_settle() ?? 0),
		immediate: () => {
			deepLinkUnit().symbols.crust_lifecycle_immediate();
		},
	};
}

/** The four bits the C delegate records, in the order JS drains them. */
export const LIFECYCLE_BITS = {
	activate: 1,
	beforeQuit: 2,
	willQuit: 4,
	reopen: 8,
} as const;

const ORDER: ReadonlyArray<readonly [number, AppEvent]> = [
	[LIFECYCLE_BITS.activate, "activate"],
	[LIFECYCLE_BITS.beforeQuit, "before-quit"],
	[LIFECYCLE_BITS.willQuit, "will-quit"],
	[LIFECYCLE_BITS.reopen, "reopen"],
];

/** Decode a native bitmask into named events. Unknown bits are ignored, never faked. */
export function lifecycleEventsFromMask(mask: number): AppEvent[] {
	return ORDER.filter(([bit]) => (mask & bit) !== 0).map(([, event]) => event);
}

/**
 * Build the source. The shim is injected so a test can drive every bit and the
 * settle handshake without AppKit or a compiled binary.
 */
export function darwinLifecycleSource(
	shim: LifecycleShim = darwinLifecycleShim(),
): LifecycleSource {
	return {
		take: () => lifecycleEventsFromMask(shim.take()),
		settle: () => {
			shim.settle();
		},
		immediate: () => {
			shim.immediate?.();
		},
	};
}
