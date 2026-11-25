# perf — read-only defect hunt

Scope: `src/perf/**`, `src/plugins/perf.ts`, `src/cli/perf/**`. No source files changed.
Tree at review: `2174a6d` (`docs(install): re-measure the tag for 0.2.18`), clean worktree.

## Findings

### 1. High — frame sampler never bounds its delta window

`src/perf/overlay/sampler.ts:89-93`

```ts
while (stamps.length > 0 && (stamps[0] ?? 0) < at - 1000) stamps.shift();
while (deltas.length > 0 && (stamps[0] ?? 0) < at - windowMs) deltas.shift();
```

The second loop tests `stamps[0]`, but the first loop has already trimmed `stamps` to the last
1000 ms. With the default `windowMs = 10_000`, `stamps[0]` can never be older than 10 s, so the
condition is always false. `deltas` grows one entry per frame for the sampler's whole life, and
`frame()` copies and sorts the entire array once per second (`:108`).

Reach: every `mountOverlay()` (via `createSampler`) and `crust perf record` — `page-sampler.ts:7`
reuses the same sampler. `start()` (`:123-129`) resets `startedAt` and `lastFrame` but not `deltas`,
so hide/show of the overlay also retains frames from before the hide.

Measured with an injected clock/rAF driver (600 frames at 20 ms, then 100 frames at 1 ms, elapsed
12.1 s, default 10 s window):

```
{"elapsedMs":12100,"earlyP50":20,"lateP50":20,"lateWorst":20,"frames":700}
```

A 10 s rolling window should report p50≈1 ms; the stale 20 ms deltas dominate p50/p95/worst.
Impact: recorded `frame.p50/p95/worst` are contaminated by the first seconds of a run, and a
long-lived overlay grows memory and sort cost without bound.

### 2. High — `PerfSample.at` subtracts two different clocks

`src/perf/collector.ts:55` sets `startedAt = Date.now()` (epoch ms). `src/plugins/perf.ts:44`
defaults `now` to `() => performance.now()` (ms since process start). `buildSample` subtracts them
(`src/perf/sample.ts:51`).

Measured with the public default:

```
default at -1795578227187.6  startedAt 1795578227191  perf.now 3.52225
```

Reach: every app that calls `createPerfPlugin()` with no `now` — the documented usage at
`site/public/SKILL.md:325`, `examples/perf-overlay/main.ts:8`, and the installed-package proof in
`scripts/verify-package/phases/install.ts:70`. `crust perf record` passes `Date.now()` explicitly
(`src/cli/perf/record.ts:107`), so record files are unaffected; the page-facing `perf.sample()` API
returns a ~-55-year `at`. `src/plugins/perf.test.ts:52` asserts `1000 - collector.startedAt`, so the
gate currently enshrines the wrong value.

### 3. High — SIGINT/SIGTERM/SIGHUP handler re-raises its own signal without unregistering

`src/cli/perf/launch.ts:57-66`

```ts
const onSignal = (signal) => {
  cleanupSync();
  process.kill(process.pid, signal);
};
```

The handler stays registered when the signal is re-sent, so the next delivery invokes it again.
Measured in an isolated Bun process with a guard at 50 re-entries:

```
RECURSED 51
```

Reach: a Ctrl-C or external `SIGTERM` during `crust perf record` (handlers are installed by
`launchApp` and removed only by `stop()` in `record()`'s `finally`). Impact: the recorder does not
terminate on the signal; it loops on cleanup plus signal delivery until an external `SIGKILL`.

### 4. Medium — failed re-record leaves a stale output file

`src/cli/perf/record.ts:73-76, 128-130, 139-150`

Only the process-gate failure removes `out` (`:142-147`). The `STALLED` verdict (`:149-150`),
`summary === undefined` (`:139-141`), and every `catch`/`fail()` after `out` is computed return a
failure code without removing an existing file. The STALLED reason literally says "no sample
written" (`:47-49`).

Reach: produce a valid `perf.json`, then re-run against an app whose renderer never paints. The
command exits 2 while the old `perf.json` remains on disk. A downstream `crust perf diff` can read
that stale sample as the new run's result.

### 5. Medium — cumulative counters are diffed across runs of different lengths

`src/cli/perf/format.ts:34-39` sums cumulative `invoke[name].count` and calls it
`invokeThroughput` (`src/cli/perf/types.ts:40-42`). `src/cli/perf/diff.ts:40,59` scores that and
cumulative `frame.framesDrawn` as higher-is-better. `meta.seconds` is recorded but
`diffRecords()` never reads it, and `record()` accepts any duration from 1 to 10 s
(`src/cli/perf/record.ts:84`).

Reach: diff a 10 s baseline against a 1 s run of the same app. Both counters fall roughly 10× and
are reported as regressions; reversing the files reports a false improvement. `frame.fps`, by
contrast, is the last window's rate, so one summary mixes run totals with an instantaneous rate.

### 6. Low — from-zero delta has inverted sign and ignores tolerance for "lower" fields

`src/cli/perf/diff.ts:69-79`

For `before === 0, after > 0`: `bad = better === "lower" && after > 0`, `pct = bad ? Infinity : -Infinity`,
but `text = "+inf"`. A `frame.fps` improvement from 0 to 5 therefore prints `+inf` with an internal
`pct` of `-Infinity`. A `lower`-is-better field going from 0 (e.g. no invokes in the baseline, so
`invoke.p95 === 0`) to any positive value is always a regression, whatever `--tolerance` says.

### 7. Low — overlay keydown listener outlives `destroy()`

`src/perf/overlay/overlay.ts:156-166` registers a `document` `keydown` listener; `destroy()`
(`:183-187`) stops the interval, sampler and panel but never removes it. Mounting and destroying
an overlay repeatedly leaves every old handler live, each toggling a destroyed instance on
Cmd+Shift+P.

### 8. Low — panel drag has no pointer capture

`src/perf/overlay/panel.ts:133-146` listens for `pointermove`/`pointerup` on the header only. If
the pointer leaves the header mid-drag, `drag` is never cleared: a later hover over the header
moves the panel with no button held, and the final corner is never persisted through
`store.set()`.

### 9. Low — one `TextDecoder` decodes both stdout and stderr

`src/cli/perf/command.ts:70-73` creates a single streaming decoder and shares it between two
independently pumped pipes. Streaming state is per decoder, so interleaved multi-byte UTF-8
characters split across stdout/stderr chunks can decode incorrectly.

### 10. Low — launch failure removes unrelated signal handlers

`src/cli/perf/launch.ts:137-144` uses `process.removeAllListeners(signal)` for SIGINT/SIGTERM/
SIGHUP on the error path. Any handler another module registered for those signals is removed too.

## Notes on claims checked and rejected

- No mismatch in the recorder's own clock: `record.ts:107` passes `Date.now()`, matching
  `Collector.startedAt`. Finding 2 is limited to the page-facing plugin's default.
- `process.kill(-pid, ...)` in `command.ts:28-40` is a valid process-group signal on macOS; the
  fallback to the child PID is correct.
- `Histogram` bounds and percentile interpolation are internally consistent; no defect found
  there.
- `app-root.ts`, `perf-native.c`, `perf-native.ts`, `conditions.ts` and `processes.ts`: no
  reachable defect found in this pass.
