/** The runtime profiler surface: the singleton, the record type and the bounded histogram. */

export { Collector, perfCollector } from "./collector.ts";
export type { EventStat, InvokeStat, LogStat, Sinks } from "./collector.ts";
export { Histogram, LATENCY_BOUNDS_MS } from "./histogram.ts";
export { buildSample } from "./sample.ts";
export type { FrameStats, PerfSample } from "./sample.ts";
