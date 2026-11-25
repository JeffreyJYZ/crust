/**
 * Per-window serialization. Only commands against the same window queue behind one another, so a
 * hung evaluation on A cannot hold up B. Kept apart from the eval correlator because it is a
 * promise chain, not the state machine that matches completions to ids.
 */

export function createLabeledQueue(): {
	run<T>(label: string | undefined, task: () => Promise<T>): Promise<T>;
	clear(): void;
} {
	const chains = new Map<string, Promise<unknown>>();
	return {
		run(label, task) {
			const key = label ?? "";
			const previous = chains.get(key) ?? Promise.resolve();
			const next = previous.then(task, task);
			chains.set(
				key,
				next.catch(() => undefined),
			);
			return next;
		},
		clear() {
			chains.clear();
		},
	};
}
