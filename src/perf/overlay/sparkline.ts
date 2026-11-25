/**
 * One canvas, one polyline, no per-frame work. The overlay calls `push` once a second with that
 * second's p95 frame time and draws immediately; nothing in a rAF callback touches this file.
 * The red band is a threshold marker at 32 ms, the frame budget the overlay contract names.
 */

export interface DrawContext {
	clearRect(x: number, y: number, w: number, h: number): void;
	fillRect(x: number, y: number, w: number, h: number): void;
	beginPath(): void;
	moveTo(x: number, y: number): void;
	lineTo(x: number, y: number): void;
	stroke(): void;
	fillStyle: string;
	strokeStyle: string;
	lineWidth: number;
}

export interface CanvasLike {
	width: number;
	height: number;
	getContext(kind: "2d"): DrawContext | null;
}

export interface SparklineOptions {
	/** Rolling span in ms. Default 10 s. */
	spanMs?: number;
	/** Red band above this frame time. Default 32 ms. */
	thresholdMs?: number;
	maxMs?: number;
}

export function createSparkline(canvas: CanvasLike | null, options: SparklineOptions = {}) {
	const spanMs = options.spanMs ?? 10_000;
	const thresholdMs = options.thresholdMs ?? 32;
	const maxMs = options.maxMs ?? 64;
	const ctx =
		canvas !== null && typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
	const samples: number[] = [];
	const at: number[] = [];

	function push(ms: number, now: number): void {
		samples.push(ms);
		at.push(now);
		while (at.length > 0 && (at[0] ?? 0) < now - spanMs) {
			at.shift();
			samples.shift();
		}
	}

	function draw(): void {
		if (ctx === null || canvas === null) return;
		const { width, height } = canvas;
		ctx.clearRect(0, 0, width, height);
		const yOf = (ms: number): number => height - (Math.min(ms, maxMs) / maxMs) * height;
		const bandY = yOf(thresholdMs);
		// The band exists always; it turns red only while p95 is over budget.
		const over = samples.length > 0 && (samples.at(-1) ?? 0) > thresholdMs;
		ctx.fillStyle = over ? "rgba(255,77,79,0.18)" : "rgba(126,231,135,0.08)";
		ctx.fillRect(0, 0, width, bandY);
		ctx.strokeStyle = over ? "#ff4d4f" : "#7ee787";
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let i = 0; i < samples.length; i++) {
			const x = samples.length === 1 ? 0 : (i / (samples.length - 1)) * width;
			const y = yOf(samples[i] ?? 0);
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.stroke();
	}

	return {
		push,
		draw,
		clear(): void {
			samples.length = 0;
			at.length = 0;
		},
		get count(): number {
			return samples.length;
		},
		get overBudget(): boolean {
			return samples.length > 0 && (samples.at(-1) ?? 0) > thresholdMs;
		},
	};
}

export type Sparkline = ReturnType<typeof createSparkline>;
