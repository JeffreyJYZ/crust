/**
 * clock — an extension that owns state and pushes events.
 *
 * An extension is a plugin a project ships as its own `.ts` file: `crust dev` imports it and
 * `crust build` embeds it in the binary, so nothing in `main.ts` registers it. What makes this one
 * more than a plain plugin is the state it keeps between calls — a running interval and a tick
 * count — and the handler context it uses to emit `clock:tick` to every page on the bridge.
 *
 * Every command refreshes the sink, so a page that calls `now` after a reload still receives the
 * ticks of a timer another page started. `stopTimer` clears the interval, so a stopped clock leaves
 * nothing running.
 */
import type { PluginContext } from "crust/plugin";
import { defineExtension } from "crust/extension";

/** What a page gets when it passes no `everyMs`. */
const DEFAULT_EVERY_MS = 1000;

interface TimerArgs {
	everyMs?: number;
}

/** The context of the most recent call: the timer emits through whoever last reached us. */
let sink: PluginContext | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let ticks = 0;
let startedAt = 0;

function running(): boolean {
	return timer !== undefined;
}

function emitTick(everyMs: number): void {
	ticks += 1;
	sink?.emit("clock:tick", { tick: ticks, everyMs, at: new Date().toISOString() });
}

export default defineExtension({
	name: "clock",
	commands: {
		/** The reading: the time, how many ticks this run has emitted, and whether it runs. */
		now: (_args: unknown, ctx: PluginContext) => {
			sink = ctx;
			return { iso: new Date().toISOString(), ticks, running: running() };
		},
		/** Start the interval. Starting a clock that is already running only reports its state. */
		startTimer: (args: TimerArgs | null, ctx: PluginContext) => {
			sink = ctx;
			const everyMs = args?.everyMs ?? DEFAULT_EVERY_MS;
			if (typeof everyMs !== "number" || !Number.isFinite(everyMs) || everyMs <= 0) {
				throw new Error(
					`clock.startTimer: everyMs must be a positive number, got ${String(everyMs)}`,
				);
			}
			if (!running()) {
				ticks = 0;
				startedAt = Date.now();
				timer = setInterval(() => emitTick(everyMs), everyMs);
			}
			return { running: true, everyMs, ticks };
		},
		/** Stop the interval and report how long this run lasted. */
		stopTimer: (_args: unknown, ctx: PluginContext) => {
			sink = ctx;
			const ranForMs = running() ? Date.now() - startedAt : 0;
			if (timer !== undefined) clearInterval(timer);
			timer = undefined;
			return { running: false, ticks, ranForMs };
		},
	},
});
