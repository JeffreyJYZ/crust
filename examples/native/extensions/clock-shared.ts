/**
 * One TypeScript half for both native clocks. The dylibs export the same three C symbols, so the
 * commands, the state and the events are written once and the language under `bun:ffi` disappears
 * above this file — only `flavor` records which one a call reached, so a page's answer proves which
 * dylib answered it.
 *
 * The commands are `clock.ts`'s, from `examples/extensions`: `now` reads, `startTimer` owns an
 * interval, `stopTimer` reports the run. What differs is where the numbers come from — the epoch
 * reading, the elapsed time and the tick count are all computed in native code.
 */
import type { PluginContext } from "crust/plugin";
import { defineExtension } from "crust/extension";

/** The three symbols both dylibs export, already bound by the generated module. */
export interface NativeClock {
	/** Epoch milliseconds, from the dylib. */
	nowMs: () => number;
	/** Milliseconds between two readings, clamped at zero. */
	ranFor: (startedMs: number, atMs: number) => number;
	/** Ticks of `everyMs` that fit in the run. */
	ticksBetween: (startedMs: number, everyMs: number, atMs: number) => number;
}

export interface NativeClockOptions {
	/** The extension name: the bridge namespace, and the prefix of its events. */
	name: string;
	/** `zig` or `rust`, reported by `now` so a caller can prove which dylib answered. */
	flavor: string;
	native: NativeClock;
}

/** What a page gets when it passes no `everyMs`. */
const DEFAULT_EVERY_MS = 1000;

interface TimerArgs {
	everyMs?: number;
}

/** Declare one native clock. State lives here, arithmetic lives in the dylib. */
export function nativeClock(options: NativeClockOptions) {
	const { name, flavor, native } = options;
	let sink: PluginContext | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let everyMs = DEFAULT_EVERY_MS;
	let startedAt = 0;

	function emitTick(): void {
		const ticks = native.ticksBetween(startedAt, everyMs, native.nowMs());
		sink?.emit(`${name}:tick`, { tick: ticks, everyMs, flavor });
	}

	function report(command: string, value: unknown): void {
		console.log(`  ${name}.${command} ${JSON.stringify(value)}`);
	}

	return defineExtension({
		name,
		commands: {
			/** The reading, with the epoch value and the tick count taken from the dylib. */
			now: (_args: unknown, ctx: PluginContext) => {
				sink = ctx;
				const at = native.nowMs();
				const value = {
					iso: new Date(at).toISOString(),
					ticks: timer === undefined ? 0 : native.ticksBetween(startedAt, everyMs, at),
					running: timer !== undefined,
					flavor,
				};
				report("now", value);
				return value;
			},
			/** Start the interval. Starting a clock that already runs only reports its state. */
			startTimer: (args: TimerArgs | null, ctx: PluginContext) => {
				sink = ctx;
				const wanted = args?.everyMs ?? DEFAULT_EVERY_MS;
				if (typeof wanted !== "number" || !Number.isFinite(wanted) || wanted <= 0) {
					throw new Error(
						`${name}.startTimer: everyMs must be a positive number, got ${String(wanted)}`,
					);
				}
				if (timer === undefined) {
					everyMs = wanted;
					startedAt = native.nowMs();
					timer = setInterval(emitTick, everyMs);
				}
				const value = { running: true, everyMs, flavor };
				report("startTimer", value);
				return value;
			},
			/** Stop the interval and report how long this run lasted, measured natively. */
			stopTimer: (_args: unknown, ctx: PluginContext) => {
				sink = ctx;
				const ranForMs = timer === undefined ? 0 : native.ranFor(startedAt, native.nowMs());
				if (timer !== undefined) clearInterval(timer);
				timer = undefined;
				const value = { running: false, ticks: 0, ranForMs, flavor };
				report("stopTimer", value);
				return value;
			},
		},
	});
}
