/**
 * Backend for the perf probe. Every command the page calls lives in one plugin,
 * so the config needs one capability. `report` writes the measured JSON to the
 * path the harness put in CRUST_PERF_OUT and attaches backend memory facts.
 */
import { writeFile } from "node:fs/promises";
import { app } from "crust";
import { definePlugin, type PluginContext } from "crust/plugin";

let emitter: PluginContext | undefined;
let ticker: ReturnType<typeof setInterval> | undefined;
let pings = 0;
let events = 0;
let eventHz = 0;

/** Both counters are evidence the three levels actually differed. */
const perf = definePlugin({
	name: "perf",
	commands: {
		ping: () => ({ n: ++pings }),
		// Backend timers are not throttled by a hidden webview, so this paces the
		// page's sustained workload without depending on page timers.
		pace: async ({ ms }: { ms?: number }, ctx: PluginContext) => {
			await Bun.sleep(typeof ms === "number" ? Math.min(Math.max(ms, 1), 100) : 16);
			return { n: ++pings, at: Date.now() };
		},
		stream: ({ hz }: { hz?: number }, ctx: PluginContext) => {
			emitter = ctx;
			if (ticker !== undefined) clearInterval(ticker);
			const envHz = Number(process.env.CRUST_PERF_EVENT_HZ);
			const rate =
				Number.isFinite(envHz) && envHz > 0
					? envHz
					: typeof hz === "number" && hz > 0
						? hz
						: 30;
			eventHz = rate;
			ticker = setInterval(
				() => {
					events += 1;
					emitter?.emit("perf:tick", { n: events, at: Date.now() });
				},
				Math.round(1000 / rate),
			);
			return { started: true, hz: rate };
		},
		stop: () => {
			if (ticker !== undefined) clearInterval(ticker);
			ticker = undefined;
			emitter = undefined;
			return { stopped: true, events };
		},
		report: async ({ json }: { json: string }, ctx: PluginContext) => {
			// Stop the stream before the final write; a hidden page cannot drain it.
			if (ticker !== undefined) clearInterval(ticker);
			ticker = undefined;
			const path = process.env.CRUST_PERF_OUT;
			if (typeof path !== "string" || path.length === 0) {
				throw new Error("CRUST_PERF_OUT is not set");
			}
			const memory = process.memoryUsage();
			const record = {
				...JSON.parse(json),
				backend: {
					pingCount: pings,
					eventCount: events,
					eventHz,
					heapUsedBytes: memory.heapUsed,
					rssBytes: memory.rss,
				},
			};
			await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
			ctx.emit("perf:reported", { path });
			return { written: true, path };
		},
		quit: () => {
			void app.quit();
			return { quitting: true };
		},
	},
});

app.use(perf);
app.on("window-all-closed", () => void app.quit());
await app.run();
