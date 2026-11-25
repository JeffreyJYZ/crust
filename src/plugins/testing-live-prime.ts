/**
 * The composited-bit hold the live page test needs. A view WebKit never composited never calls the
 * eval completion handler — the same mechanism that makes `window.capture` answer `no-completion`.
 * Keeping the hold here rather than in the test keeps the test under the 200-line cap and gives the
 * one-owner rule a single home beside the occlusion hold it sits next to.
 *
 * Private NSWindow SPI, harness only, never a shipped default. The owner is ref-counted, so a
 * capture that also opts in shares the bit instead of clearing it under this running page.
 */

import { primeOwner } from "../platform/darwin/occlusion.ts";
import { darwinSnapshotShim } from "../platform/darwin/snapshot.ts";

/** Whether this macOS still has the private setter; a missing one is a hard failure in the test. */
export function compositedAvailable(web: number): boolean {
	return Boolean(darwinSnapshotShim().primeAvailable?.(web));
}

/** One held bit with one release, so the test's `finally` has exactly one thing to undo. */
export interface CompositedHold {
	release(): void;
}

/** Set the bit for the caller's lifetime and throw by name when the private selector is absent. */
export function holdComposited(web: number): CompositedHold {
	const shim = darwinSnapshotShim();
	const holder = Symbol("testing-live composited bit");
	// The owner's `false` means "acquired"; this SPI's 1 is what sets the bit, so invert.
	const acquired = primeOwner.acquire(web, holder, (target, enabled) =>
		Boolean(shim.prime?.(target, !enabled)),
	);
	if (!acquired) {
		throw new Error(
			"crust: testing-live prime-unavailable: _setOcclusionStateIsVisible: is absent on this macOS",
		);
	}
	return { release: () => primeOwner.release(web, holder) };
}
