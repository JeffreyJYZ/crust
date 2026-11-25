/**
 * A fixed, repeatable paint workload and a frame counter that shares nothing with the overlay.
 * The overlay's sampler has its own rAF callback; this loop has its own. Both observe the same
 * frames, so comparing their fps at one instant is a real check, not two views of one variable.
 */
window.__probe = (function () {
	const canvas = document.getElementById("work");
	const ctx = canvas.getContext("2d");
	const W = canvas.width;
	const H = canvas.height;
	const WINDOW_MS = 10_000;
	let deltas = [];
	let stamps = [];
	let last = 0;
	let running = false;
	let raf = 0;
	let startedAt = 0;

	function paint(now) {
		ctx.fillStyle = "#16161c";
		ctx.fillRect(0, 0, W, H);
		for (let i = 0; i < 80; i++) {
			ctx.fillStyle = "hsl(" + ((i * 4 + now / 50) % 360) + ",70%,50%)";
			ctx.fillRect((i * 7) % W, (i * 13) % H, 20, 20);
		}
	}

	function prune(at) {
		while (stamps.length > 0 && stamps[0] < at - WINDOW_MS) {
			stamps.shift();
			deltas.shift();
		}
	}

	function tick(now) {
		if (!running) return;
		if (last !== 0) {
			deltas.push(now - last);
			stamps.push(now);
		}
		last = now;
		prune(now);
		paint(now);
		raf = requestAnimationFrame(tick);
	}

	function percentile(sorted, fraction) {
		if (sorted.length === 0) return 0;
		const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
		return sorted[at] ?? 0;
	}

	function stats() {
		const sorted = [...deltas].sort((a, b) => a - b);
		return {
			frames: deltas.length,
			p50: percentile(sorted, 0.5),
			p95: percentile(sorted, 0.95),
			worst: sorted.at(-1) ?? 0,
		};
	}

	return {
		start() {
			deltas = [];
			stamps = [];
			last = 0;
			startedAt = performance.now();
			running = true;
			raf = requestAnimationFrame(tick);
			return startedAt;
		},
		stop() {
			running = false;
			cancelAnimationFrame(raf);
			return { ...stats(), durationMs: performance.now() - startedAt };
		},
		/** Frames in the last second over that second — the same definition the overlay uses. */
		fps() {
			const at = performance.now();
			prune(at);
			const from = at - 1000;
			let count = 0;
			for (const stamp of stamps) if (stamp >= from) count += 1;
			return (count * 1000) / Math.max(1, Math.min(1000, at - startedAt));
		},
		stats,
		layout() {
			const rect = document.getElementById("sentinel").getBoundingClientRect();
			return {
				height: document.body.scrollHeight,
				sentinel: { top: rect.top, left: rect.left, width: rect.width },
			};
		},
		get running() {
			return running;
		},
	};
})();
