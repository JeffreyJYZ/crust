# Perf baseline, lane A — measured on this machine

**Verdict: indicative, not a baseline.** This run is marked `contaminated`: one-minute load
was **4.69 measured** at the start and **4.12 measured** at the end, both above the 2.0 limit in
`docs/plan/perf/BRIEF.md`. Three sibling lanes were building and running suites. Do not compare
these fps numbers to a later run as if the machine were the same.

JSON sample with all three levels: `docs/reviews/perf/baseline.json`.
Split-validation sample (two levels only): `docs/reviews/perf/baseline-final.json`.
Harness: `scripts/perf/measure.ts` with `scripts/perf/conditions.ts`,
`scripts/perf/kill-guard.ts`, `scripts/perf/compare.ts`.
Probe app: `examples/perf-probe/` (`crust.config.ts`, `main.ts`, `public/`).

## What was measured

A fixed workload: **60 measured** DOM rows re-rendered and **200 measured** canvas rects repainted
per tick, three consecutive **3000 ms measured** windows. Numbers below are from the page and are
labelled `measured`; numbers derived from them are labelled `derived`.

| Level | fps | frame p50 | frame p95 | long tasks >50 ms | long frames >50 ms | load start → end | bun start → end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| none | 44.56 `measured` | 22.00 ms `measured` | 25.00 ms `measured` | 0 `measured` | 0 `measured` | 4.69 → 4.12 `measured` | 17 → 17 `measured` |
| one invoke/second | 0.00 `measured` | n/a `measured` | n/a `measured` | 0 `measured` | 0 `measured` | 4.69 → 4.12 `measured` | 17 → 17 `measured` |
| sustained invoke only | 26.80 `measured` | 24.00 ms `measured` | **212.00 ms `measured`** | 0 `measured` | 8 `measured` | 4.69 → 4.12 `measured` | 17 → 17 `measured` |

Frame counts: **148 measured** (none), **0 measured** (one/sec), **81 measured** (sustained).
Bridge counts: **0 measured** invokes (none), **2 measured** (one/sec), **87 measured**
(sustained); backend total **89 measured** pings.
Worst long-task count: **0 measured** from `PerformanceObserver` (`longtask` supported, no
entries). Worst long-frame count: **8 measured** at sustained load.

Heap: page `performance.memory` is **absent `measured`** in this WKWebView, so page heap is `null`.
Proxy on the Bun backend at report time: **6,932,108 bytes heapUsed `measured`**,
**70,255,960 bytes RSS `measured`**. These are not webview heap and must not be read as such.

`window.capture` (crust's own capture, no OS screenshot): **ok `measured`**, **1800×1280 `measured`**
at **scale 2 `measured`**, **148,192 base64 bytes `measured`**.

## What blocked whole-app measurement

- The probe uses `testing.activation: "none"`, as required. The page reports
  `document.visibilityState = "hidden"` `measured`. In that state requestAnimationFrame is
  throttled to a stop in some windows: the one-invoke-per-second window delivered **0 frames
  `measured`**, so its fps and frame percentiles are real zeros, not missing data.
- A backend SSE `perf:tick` stream at **30 Hz attempted** and then **2 Hz attempted** froze the
  hidden page's timers; five earlier probe attempts were killed at the 14 s deadline before the
  page could write JSON. Those attempts produced console diagnostics only (`visibility=hidden`,
  `fps 0`, stream started but no subsequent level), not a sample. They are not silently deleted:
  this paragraph is their record.
- The reported sustained window therefore uses **backend-paced invokes** (`perf.pace`, 16 ms
  requested): backend timers are not throttled. It is a sustained-invoke proxy, **not** the
  required sustained invoke + event stream. Event-stream cost is **not measured** here; claiming
  it would be guessing.
- Driver per row is in the JSON: `requestAnimationFrame`, `timer-16ms`, `backend-paced-invoke`.
  Only the first is a compositor-frame measurement; the other two are timer/round-trip proxies.

## Process and focus safety

- Probe-scoped `bun`/app processes: **0 before, 0 after, 0 new `measured`**, leak gate **PASS
  `measured`**. Global `bun` processes: **17 before, 17 after `measured`**; siblings are visible
  there and are reported, not used as a leak gate.
- Every run is killed by recorded PID in a trap covering success, throw, the 14 s deadline, and
  SIGINT/SIGTERM/SIGHUP. No OS screenshot and no activation or cursor movement was used.
- Probe wall time is **11.3 s `derived`** from the start/end timestamps in the JSON, within the
  15 s limit.

## Exact commands

Run from `~/dev/worktrees/crust/perf-baseline`, branch `perf/baseline`:

```
bun run src/cli/index.ts build --dir examples/perf-probe
bun run scripts/perf/measure.ts measure --label baseline
bun run scripts/perf/measure.ts compare baseline baseline
```

The third command printed `compare: OK load drift 0.00; contaminated true/true`. The refusal
path was checked with a copy whose start load was rewritten to 1.0:

```
jq '.conditions.start.load.one = 1.0' docs/reviews/perf/baseline.json > /private/var/folders/mv/nj8xwzr10psf34t9m8dsxhwc0000gn/T/opencode/low-load.json
bun run scripts/perf/measure.ts compare /private/var/folders/mv/nj8xwzr10psf34t9m8dsxhwc0000gn/T/opencode/low-load.json docs/reviews/perf/baseline.json
```

It printed `compare: REFUSE load drift 3.69 > 1.0` and exited 1.

## One number to attack first

**212.00 ms measured frame-time p95** under sustained invokes, with **8 measured** long frames.
That is the largest tail in the sample. It is contaminated and proxy-driven, so the next pass must
be `--label after` on a quiet machine with interleaved A/B and a same-flag-vs-itself control row
before any fix is credited.
