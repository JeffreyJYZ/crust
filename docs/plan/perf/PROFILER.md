# crust profiler: the overlay, the recorder, and the cost of both

The debug overlay has to answer "why is this app slow" without a profiler attach, on a machine where
the developer has crust dev running. That means three surfaces over one collector:

1. **In-app overlay** — a page-side widget a developer toggles at runtime.
2. **Headless recorder** — the same numbers, written to JSON by a CLI, so a lane can diff before/after.
3. **Runtime counters** — the backend half: invokes, events, timers, log cost, event-loop delay.

Everything below is measured against the design rule: **off costs nothing measurable.**

## Telemetry contract

A single record type, so the overlay, the CLI and any test read the same shape.

```ts
type PerfSample = {
	at: number; // ms since app start
	frame: {
		fps: number; // frames in the last second
		p50: number; // frame time ms
		p95: number;
		worst: number;
		longTasks: number; // >50ms in the last second
	};
	runtime: {
		eventLoopDelayP95: number; // ms, monotonic histogram
		heapUsed: number; // bytes
		heapTotal: number;
	};
	invoke: Record<string, { count: number; p50: number; p95: number; errors: number }>;
	events: { emitted: number; delivered: number; dropped: number; p95: number };
	log: { records: number; ms: number }; // per second
};
```

Sinks are opt-in and independent: `overlay`, `file`, `stdout`. Turning all three off must leave the
instrumented code paths on a `if (!enabled) return` with no allocation — that is the test, not a claim.

## Where each number comes from

| number | source | notes |
| --- | --- | --- |
| fps / frame times | page `requestAnimationFrame` deltas | the page's own compositor view, which is what a user sees |
| long tasks | `PerformanceObserver({ type: "longtask" })` | absent on the embedded webview if unsupported → report `n/a`, never `0` |
| event-loop delay | `perf_hooks.monitorEventLoopDelay` in the runtime | backend stall, which is the usual cause of a bridge that feels laggy |
| heap | `process.memoryUsage().heapUsed` | sample on the tick, not per invoke |
| invoke per plugin | counters at the bridge dispatch seam | one increment on entry, one latency sample on answer |
| events | counters at emit and at delivery | `emitted - delivered` is the queue, and a growing gap is the bug |
| log cost | accumulate in the logging writer | must show whether logging is on the answering path |

Reading is **pull**: the page asks for a sample at its own cadence, so a stalled webview cannot flood
the backend and the overlay cannot become the reason the app is slow. Push only for the overlay's own
1 Hz refresh, which the page drives.

## Surfaces

### Overlay

- Toggled by a keyboard shortcut in dev and by `window.crust.perf.overlay(true)` anywhere the
  `perf` capability is granted; refused with `not-implemented` when the plugin is not mounted.
- A single `<canvas>` or a fixed DOM panel — it must not repaint the whole page. Position: top-right,
  draggable, remembers its corner in app storage.
- Shows the numbers above, plus a rolling 10 s sparkline of frame time. A red band when p95 > 32 ms.
- **Never** included in a production build unless the app asks: the runtime half ships, the overlay
  page code is only imported when enabled, and the build proves it with a size check.

### Recorder

```sh
crust perf record --app <path> --seconds 10 --out perf.json
crust perf diff before.json after.json
```

`record` runs the built app with the perf sink on, writes one `PerfSample` per second, and exits with
the p95 frame time on stdout so a shell test can assert on it. `diff` prints per-field deltas and
fails when a metric regressed past a tolerance — that is what makes a perf claim checkable in CI.

### Runtime counters

Cheap by construction: a fixed array of counters, a latency histogram per plugin name allocated once
on first use. No `Date.now()` in a hot path unless the sink is enabled — the enabled check wraps the
timing call itself.

## Tests that must exist

1. **Off costs nothing**: 10k invokes with every sink off, assert no additional allocation beyond a
   small bound and no clock reads (spy on the timing function).
2. **On reports real numbers**: run the probe app, assert fps within 5% of the probe's own counter and
   that p95 ≥ p50 > 0, with the sample JSON asserted against the recorder's own file.
3. **Invoke accounting is exact**: N invokes across two plugins, assert the per-plugin counts sum to N.
4. **Event accounting is exact**: N emits, M deliveries, assert `emitted - delivered` equals the queue
   the test left undelivered.
5. **Recorder round-trip**: `perf record` → JSON → `perf diff` on the same file reports zero delta and
   exit 0; a doctored file reports the regression and exit 1.
6. **Not in the production bundle**: build the examples for production and assert the overlay module is
   absent from the output (a byte search, not a config read).

## The seam between the two halves

`frame` cannot be measured by the runtime — only the page sees its own `requestAnimationFrame` deltas — so
the page hands them over and the runtime never invents them:

```ts
// page half, once per second at most:
window.crust.perf.frameReport({ fps, p50, p95, worst, longTasks, framesDrawn });

// either half, whenever a sample is wanted:
window.crust.perf.sample(): PerfSample // frame is null until a page has reported
```

Rules:

- `sample().frame` is `null` — never a zero-filled block — until a page half reports. A consumer must be
  able to tell "no frame data" from "0 frames", because an occluded window genuinely draws nothing and that
  is not a slow app.
- `framesDrawn` travels with the frame block, because the recorder's failure rule is "zero frames drawn",
  not "fps looks low".
- `frameReport` is fire-and-forget and bounded: last-writer-wins, one allocation per call, and it never
  wakes anything.

## Two traps the recorder must handle

- **An occluded window renders nothing.** macOS/WebKit suspends rendering for a window that is not
  frontmost and is considered occluded, so an app launched headlessly measures 0 fps — measured: 0 fps →
  ~56 fps on the same page with occlusion detection disabled (lane C). The recorder therefore disables
  window occlusion detection **in its own launch path only**, states that in the sample metadata, and
  fails the run when the page drew zero frames instead of writing a `PerfSample` that reads as slow.
  Ship-side default stays occlusion-aware: only the recorder and test scaffolding may disable it.
- **Sampling must not become the cost.** One sample per second, pulled; never per frame, never pushed
  from the runtime on a hot path.

## Non-negotiables

- No OS screenshot, no focus theft: the harness that measures the overlay uses
  `testing.activation: "none"` and `window.capture`.
- Every probe ≤ 15 s; process count before/after with a PID trap covering success, error, timeout and
  SIGINT; the run fails if the after-count exceeds baseline.
- Files ≤ 200 lines. The overlay's rendering, the collector, the CLI and the diff each get their own file.
- Backward compatible: `window.crust.perf` is additive; the capability is new and defaults to refused.
