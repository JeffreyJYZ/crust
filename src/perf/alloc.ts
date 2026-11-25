/**
 * `heapStats()` ships a `mimalloc` block in Bun but the shipped type omits it. This is the single
 * cast, so the diagnostic allocator line reads cumulative requested bytes without spreading it.
 *
 * That counter is not an oracle: it also counts the collector's own bookkeeping when GC fires
 * inside a measured window. One forced `Bun.gc(true)` mid-loop moved it by +150 KB to +365 KB
 * across an unchanged 10k loop, so a 40 KB heap bound measures GC timing, not code.
 *
 * The off-mode hooks allocate exactly once, in `Collector.stat`, when the lazy `InvokeStat` is put
 * in this map; later calls only increment existing fields (`histogram.ts` uses a fixed array).
 * Counting `set` calls on that map after warm-up is an exact allocation count for the code path
 * under test: zero means off mode allocated nothing.
 */
import { heapStats } from "bun:jsc";

interface AllocStats {
	mimalloc: { malloc_requested: number };
}

/** Cumulative bytes requested from the allocator; a delta is an allocation signal, not object size. */
export function requestedBytes(): number {
	return (heapStats() as unknown as AllocStats).mimalloc.malloc_requested;
}

/** Count writes to a state map for one measurement; `stop()` restores the original method. */
export function countWrites<K, V>(map: Map<K, V>): { read(): number; stop(): void } {
	const original = map.set.bind(map);
	let writes = 0;
	map.set = (key, value) => {
		writes++;
		original(key, value);
		return map;
	};
	return {
		read: () => writes,
		stop: () => Reflect.deleteProperty(map, "set"),
	};
}
