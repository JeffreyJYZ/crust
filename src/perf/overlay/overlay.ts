/**
 * The developer-facing half. One sampler drives one `frameReport` and one `sample()` per second —
 * never per row or per frame. Before the `perf` plugin is mounted the panel shows page-only numbers
 * and says so. `MARKER` lets a production-bundle byte search prove this module was not pulled in.
 */
import { installHotkey, type KeyHost } from "./hotkey.ts";
import { createPanel, bridgeStore, type DocumentLike, type Panel } from "./panel.ts";
import { createSampler, type FrameStats, type Sampler } from "./sampler.ts";

export const MARKER = "crust-perf-overlay/v1";

export interface PerfSampleLike {
	at: number;
	frame: FrameStats | null;
	runtime: { eventLoopDelayP95: number; heapUsed: number; heapTotal: number };
	invoke: Record<string, { count: number; p50: number; p95: number; errors: number }>;
	events: { emitted: number; delivered: number; dropped: number; p95: number };
	log: { records: number; ms: number };
}

export interface PerfApi {
	sample(): unknown;
	frameReport(frame: FrameStats): unknown;
	overlay?(...args: unknown[]): unknown;
}

export interface OverlayOptions {
	window?: Record<string, unknown>;
	doc?: DocumentLike;
	dev?: boolean;
	interval?: (fn: () => void, ms: number) => unknown;
	clearInterval?: (handle: unknown) => void;
	now?: () => number;
	sampler?: Sampler;
	panel?: Panel;
}

const isPerfApi = (value: unknown): value is PerfApi =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as PerfApi).sample === "function" &&
	typeof (value as PerfApi).frameReport === "function";

/** The framework exposes `invoke`, not a `perf` namespace; this is the thin page-side adapter. */
export function resolvePerf(scope: Record<string, unknown>): PerfApi | undefined {
	const crust = scope.crust as { perf?: unknown; invoke?: unknown } | undefined;
	if (isPerfApi(crust?.perf)) return crust.perf;
	if (typeof crust?.invoke !== "function") return undefined;
	const call = crust.invoke as (plugin: string, command: string, args?: unknown) => unknown;
	return {
		sample: () => call("perf", "sample"),
		frameReport: (frame) => call("perf", "frameReport", frame),
		overlay: (...args) => call("perf", "overlay", { enabled: Boolean(args[0]) }),
	};
}

const refusal = (value: unknown): boolean =>
	typeof value === "object" &&
	value !== null &&
	((value as { code?: unknown }).code === "not-implemented" ||
		typeof (value as { requires?: unknown }).requires === "string");

const mb = (bytes: number): string => (bytes / 1_048_576).toFixed(1);

export function mountOverlay(options: OverlayOptions = {}) {
	const scope = options.window ?? (globalThis as Record<string, unknown>);
	const now = options.now ?? (() => performance.now());
	const sampler = options.sampler ?? createSampler({ now });
	const perf = resolvePerf(scope);
	let runtimeMounted = perf !== undefined;
	let previousFrames = 0;
	let visible = false;
	let sampled: PerfSampleLike | undefined;
	const panel =
		options.panel ??
		createPanel({
			doc: options.doc,
			store: bridgeStore(scope.crust),
			onToggle: (on) => {
				visible = on;
			},
		});

	function lines(frame: FrameStats): string[] {
		const still = frame.framesDrawn === previousFrames;
		previousFrames = frame.framesDrawn;
		const head = still
			? `frame    no frames (drawn ${frame.framesDrawn}, not advancing)`
			: `frame    ${frame.framesDrawn} drawn · fps ${frame.fps.toFixed(1)} · p50 ${frame.p50.toFixed(1)} p95 ${frame.p95.toFixed(1)} worst ${frame.worst.toFixed(1)}`;
		const out = [
			`crust perf ${MARKER}`,
			head,
			`longtask ${frame.longTasks === null ? "n/a" : frame.longTasks} in the last second`,
		];
		if (!runtimeMounted || sampled === undefined) {
			out.push("runtime  runtime half not mounted — page-only numbers");
			return out;
		}
		const s = sampled;
		out.push(
			`loop     p95 ${s.runtime.eventLoopDelayP95.toFixed(2)} ms · heap ${mb(s.runtime.heapUsed)}/${mb(s.runtime.heapTotal)} MB`,
		);
		out.push(
			`events   emitted ${s.events.emitted} · delivered ${s.events.delivered} · dropped ${s.events.dropped} · p95 ${s.events.p95.toFixed(2)}`,
		);
		const names = Object.keys(s.invoke).slice(0, 3);
		out.push(
			names.length === 0
				? "invoke   none"
				: `invoke   ${names.map((n) => `${n} ${s.invoke[n]?.count ?? 0}`).join(" · ")}`,
		);
		return out;
	}

	function tick(): void {
		const frame = sampler.frame();
		if (perf !== undefined) {
			try {
				void Promise.resolve(perf.frameReport(frame)).catch(() => {});
			} catch {
				// Fire-and-forget: a bridge failure never reaches the sampler.
			}
		}
		if (perf === undefined) {
			sampled = undefined;
			panel.update(lines(frame), frame.p95, now());
			return;
		}
		try {
			void Promise.resolve(perf.sample())
				.then((answer) => {
					runtimeMounted = !refusal(answer);
					sampled = runtimeMounted ? (answer as PerfSampleLike) : undefined;
				})
				.catch(() => {
					runtimeMounted = false;
					sampled = undefined;
				})
				.finally(() => panel.update(lines(frame), frame.p95, now()));
		} catch {
			runtimeMounted = false;
			sampled = undefined;
			panel.update(lines(frame), frame.p95, now());
		}
	}

	function setVisible(on: boolean): void {
		if (on) {
			panel.show();
			sampler.start();
		} else {
			sampler.stop();
			panel.hide();
		}
		visible = on;
		try {
			void Promise.resolve(perf?.overlay?.(on)).catch(() => {});
		} catch {
			// A refused sink never blocks the page-side toggle.
		}
	}

	const handle = options.interval?.(tick, 1000) ?? setInterval(tick, 1000);
	const stopInterval = options.clearInterval ?? (clearInterval as (h: unknown) => void);
	const removeHotkey =
		options.dev === false
			? undefined
			: installHotkey(scope.document as KeyHost | undefined, () => setVisible(!visible));

	return {
		marker: MARKER,
		show: () => setVisible(true),
		hide: () => setVisible(false),
		toggle: () => setVisible(!visible),
		tick,
		get visible(): boolean {
			return visible;
		},
		get runtimeMounted(): boolean {
			return runtimeMounted;
		},
		panel,
		sampler,
		readout: () => sampler.readout(),
		destroy(): void {
			stopInterval(handle);
			sampler.stop();
			panel.destroy();
			removeHotkey?.();
		},
	};
}

export type Overlay = ReturnType<typeof mountOverlay>;
