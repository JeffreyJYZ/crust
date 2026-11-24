/**
 * `heapStats()` ships a `mimalloc` block in Bun but the shipped type omits it. This is the single
 * cast, so the two allocation assertions read cumulative requested bytes without spreading it.
 */
import { heapStats } from "bun:jsc";

interface AllocStats {
	mimalloc: { malloc_requested: number };
}

/** Cumulative bytes requested from the allocator; a delta is an allocation signal, not object size. */
export function requestedBytes(): number {
	return (heapStats() as unknown as AllocStats).mimalloc.malloc_requested;
}
