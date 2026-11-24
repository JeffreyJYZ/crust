/**
 * Fixed-size latency histogram. `record` walks a constant bound list and increments one integer:
 * no clock read, no allocation, no growth with traffic. Bounds are milliseconds and conservative —
 * a percentile reports the upper bound of the bucket holding it, so p95 never understates a sample.
 */

export const LATENCY_BOUNDS_MS = [
	0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000,
] as const;

/** Samples past the last bound land in this bucket, so a stalled machine still counts. */
const LAST_UPPER_MS = 2000;

export class Histogram {
	private readonly counts = new Uint32Array(LATENCY_BOUNDS_MS.length + 1);
	private total = 0;

	record(ms: number): void {
		if (!Number.isFinite(ms) || ms < 0) return;
		let i = 0;
		while (i < LATENCY_BOUNDS_MS.length && ms > LATENCY_BOUNDS_MS[i]!) i++;
		this.counts[i] = (this.counts[i] ?? 0) + 1;
		this.total++;
	}

	get count(): number {
		return this.total;
	}

	reset(): void {
		this.counts.fill(0);
		this.total = 0;
	}

	private upper(i: number): number {
		return i < LATENCY_BOUNDS_MS.length ? LATENCY_BOUNDS_MS[i]! : LAST_UPPER_MS;
	}

	private lower(i: number): number {
		return i === 0 ? 0 : LATENCY_BOUNDS_MS[i - 1]!;
	}

	/** Linear interpolation inside the bucket holding the p-th sample. Zero when empty. */
	percentile(percentile: number): number {
		if (this.total === 0) return 0;
		const p = Math.min(100, Math.max(0, percentile));
		const target = (p / 100) * this.total;
		let cumulative = 0;
		for (let i = 0; i < this.counts.length; i++) {
			const n = this.counts[i] ?? 0;
			if (n === 0) continue;
			cumulative += n;
			if (cumulative < target) continue;
			const before = cumulative - n;
			const span = this.upper(i) - this.lower(i);
			return this.lower(i) + span * Math.min(1, (target - before) / n);
		}
		return this.upper(this.counts.length - 1);
	}
}
