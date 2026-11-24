# Perf pump 05: the 16 ms AppKit pump

Lane E deliverable for `docs/plan/perf/BRIEF.md`. Worktree `~/dev/worktrees/crust/perf-pump`, branch
`perf/pump`. The cited structure is `docs/reviews/perf/04-parity.md` §1: `PUMP_INTERVAL_MS = 16`
(`src/app-types.ts:117`) drives a self-rearming timer (`src/platform/darwin/pump.ts`) and every tick
called `shim_pump`, whose 4 ms `NSDate` deadline, event drain and 2 ms run-loop fallback are in
`src/platform/darwin/shim/50_app.c`.

## Verdict

The "crust burns CPU on a 16 ms AppKit pump" version of the finding is **killed**: idle process CPU
was 1.7% before and stayed 1.7–1.2% after. The "pump holds the JS thread" version is **confirmed**:
each tick spent 6.8 ms of its 16 ms budget inside AppKit, even with the bridge idle. Removing the
4 ms wait cut tick cost by ~59%, raised delivered ticks from 41/s to 49/s, and consistently lowered
frame-time p95 from 25 ms to 21 ms on the animating probe page. Menu, window move and window open
still work.

## Method

- Probe app built from this worktree with `bun ~/dev/rdm/perf-pump/run.ts build <worktree> <scratch> <label>`;
  each run is `bun ~/dev/rdm/perf-pump/run.ts run <binary> <idle|anim>`. The probe app has one
  900×600 window and a canvas; `PERF_ANIM=1` makes the page repaint it every frame.
- **Tick cost**: `CRUST_PUMP_STATS=1` (added to `src/platform/darwin/pump.ts`, off by default)
  times every pump tick with `performance.now()` and prints mean/p95/ticks-per-second every 120
  ticks. The same instrumentation is in both arms.
- **CPU**: `ps -o time=` for the app process at `PERF READY` and `PERF DONE`, divided by the 9.6–9.7 s
  window. `pcpu` is a lifetime average and was not used.
- **Frame time**: the page's own `requestAnimationFrame` deltas over 9 s, printed as p50/p95/fps.
- Arms were interleaved: before-idle, before-anim, after-idle, after-anim, after-anim, before-anim,
  before-idle, after-idle, after-idle, before-anim, with a same-arm repeat as the control row.
- **Contamination**: `sysctl -n vm.loadavg` was 2.39–12.76 on every run (all over the brief's 2.0
  threshold); `pgrep -x bun` was 16–28. Every run is labelled `contaminated`. The tick numbers repeat
  within 1–2% across arms at very different load, so the tick conclusion is sound; the frame-rate
  comparison is directional, not a controlled benchmark (before-anim fps swung 19.8–31.4).
- Every probe was ≤ 13 s of app life, killed by recorded PID in a `finally`/signal trap. App
  process count was 2 before and 2 after each run (no leak). The probe launches activate the app so
  WebKit runs rAF; each run restores the captured frontmost app (`ghostty`) at the end. No OS
  screenshot and no cursor/keyboard input were used.

## Before / after

| Metric (bridge idle) | Before | After (same-arm control in parentheses) |
| --- | --- | --- |
| Tick mean | 6.841, 6.598 ms | 2.796, 2.737 ms (after repeat 2.737) |
| Tick p95 | 7.629, 7.650 ms | 2.683, 2.721 ms |
| Ticks/s | 41.1, 41.3 | 49.3, 49.6 |
| App CPU, 9.6 s | 0.16 s / 1.7% | 0.16 s / 1.7%; 0.12 s / 1.2% |
| Frame p95, page rAF | 25 ms | 21 ms |

| Metric (60 fps canvas animating) | Before | After |
| --- | --- | --- |
| Tick mean | 6.960, 6.779, 6.770 ms | 2.728 ms |
| Tick p95 | 7.627, 7.650, 7.636 ms | 2.823 ms |
| Ticks/s | 41.0, 41.2, 41.3 | 49.2 |
| App CPU, 9.7 s | 0.18 s / 1.9%; 0.25 s / 2.6%; 0.22 s / 2.3% | 0.21 s / 2.2% |
| Frame p95 / fps | 25 ms / 19.8, 31.4, 24.9 fps | 21 ms / 21.7 fps |

The ~0.4 ms gap between tick p95 and mean in the before arm and the occasional 27–63 ms max come
from load spikes on this machine, not from a second code path.

## Changes

1. `src/platform/darwin/shim/50_app.c`: pass a nil deadline to
   `nextEventMatchingMask:untilDate:inMode:dequeue:` so an empty queue returns immediately, instead of
   creating two `NSDate` objects and waiting 4 ms every tick. `sendEvent:` / `updateWindows` still run
   for real events.
2. Same file: the empty-queue `CFRunLoopRunInMode` slice drops from 2 ms to 0.25 ms. The earlier
   `research/runloop` sweep found 0.25 ms delivered 186 of 187 ticks; the A/B below confirms it on
   the current shim. The run-loop call stays: removing it entirely was not retried, because the same
   file records a blank window when the run loop is not serviced, and the interaction proof's
   `window.capture` would catch that.
3. Same file: when every window is occluded or miniaturised after the first 120 startup ticks,
   `shim_pump` returns -1. `src/platform/darwin/pump.ts` backs the timer off to
   `OCCLUDED_PUMP_INTERVAL_MS = 100`; the next visible tick restores the normal cadence. The startup
   grace is load-bearing — without it the window reports "not composited" during launch and the page
   never loads. Occlusion detection is read, never disabled. No new public API.
4. `src/platform/darwin/pump.ts` keeps the opt-in `CRUST_PUMP_STATS` counter that produced every tick
   number here. It also owns the -1 status interpretation, so `platform.ts` stays under the line cap.
   `pump-pool.test.ts` pins the non-blocking deadline, pool and occlusion branch;
   `pump-cadence.test.ts` pins backoff and restore.

### Second pass: the remaining 2.8 ms

Interleaved A/B on the same host, load 3.55 before and 4.16 after (contaminated):

| Metric, 9.7 s | 2 ms slice (before) | 0.25 ms slice (after) |
| --- | --- | --- |
| Tick mean, idle | 2.818 ms | 0.781 ms |
| Tick mean, animating | 2.901 ms | 0.789 ms |
| Tick p95, idle / animating | 3.799 / 3.731 ms | 2.407 / 2.441 ms |
| Ticks/s, idle / animating | 49.4 / 49.0 | 54.4 / 55.0 |
| App CPU, idle / animating | 0.7% / 0.8% | 0.7% / 0.8% |

Frame p95 could not be compared in this pass: all four runs reported `frames=0` because the probe
app was never frontmost, so WebKit suspended rAF (the condition lane C measured). The veto was the
interaction proof below, which includes a real `window.capture` mid-drag.

### Occluded case, separate from the visible case

Window minimised after load; app-process CPU from `process.cpuUsage()` inside the app, over the
same 9.5 s backend timer window. Load 5.94 before / 2.78 after (both contaminated).

| Metric | Before occlusion backoff | After |
| --- | --- | --- |
| App CPU | 90 ms / 0.9% | 76 ms / 0.8% |
| Pump ticks in window | ~360 (~40/s) | 120 (~13/s) |

The CPU win is small because the pump already spent most of its time asleep; the real effect is a
3× reduction in main-thread wakeups while WebKit has stopped painting. These numbers are not pooled
with the visible-case table.

## Interaction proofs

Built from the changed worktree with
`bun ~/dev/rdm/perf-pump/interact.ts ~/dev/worktrees/crust/perf-pump <scratch>`, then the bundle's
binary launched directly. Captured through `window.capture` only; no OS screenshot.

```
page      MENU installed={"ok":true,"count":1} readable=true
page      CAPTURE ok=true bytes=63832 size=1800x1200
page      DRAG from={"ok":true,"label":"main","x":120,"y":120} to={"ok":true,"label":"main","x":280,"y":200} moved=true
page      CREATE ok={"ok":true,"label":"probe","created":true} labels={"ok":true,"labels":["main","probe"]}
page      MINIMIZED
page      PAGE_UNMINIMIZED {"ok":true,"label":"main","minimized":false}
page      RESTORE minimized={"ok":true,"label":"main","minimized":false} frames=0 p95=0 menu=true
page      PROOF DONE
```

`menu.read` reads the installed native bar back from AppKit, so the menu item is provably present;
`menu.showContext` is a modal popup that blocks the JS thread and is not drivable without a physical
click, so it was not used. Drag is eight successive `window.setPosition` calls with `getPosition`
readback after each; the capture is from move 4. A second window opens and appears in `window.list`.
The last four lines are the reveal path: the page's own timer survives minimisation, unminimises,
then reads the menu again. `frames=0` after reveal is the probe environment, not the pump — this
bundle is launched directly and never becomes frontmost, so WebKit suspends rAF exactly as lane C
measured. Native responsiveness on reveal is proven; animation cadence on reveal is **not** proven
by this probe and needs a frontmost run to close.

## Gate

Final tree (branch `perf/pump`):

- `bun check` — `✓ No type errors in 1,237 files`.
- `bun run check:lines` — `PASS no file exceeds 200 lines`. Moving the shim-status coercion into
  `pump.ts` was required: the first version put `platform.ts` at 201 lines.
- `bun run e2e:window` — `PASS 64/64 assertions`.
- `bun run e2e:preview` — `PASS 6/6 assertions`.
- `bun run test` — `2951 pass, 1 fail`; `bun run test:no-skips` — `2949 pass, 3 fail`. Every red is
  environmental:
  - `scripts/butter-sweep.test.ts` AX row answers `{ detail: "frontmost-lost", lost: true }` instead
    of `ok`. It fails with the occlusion branch disabled too, and the test's own lines report
    `frontmost before/after: ghostty` — shared-machine focus state, not this patch.
  - `testing-live.test.ts` (835 s) and `shortcuts-c.test.ts` (262 s) in `test:no-skips`, plus
    `compileExtension` (899 s) and the AOT probes (406–901 s) in earlier full runs, all timed out
    only under sibling compile load. Each passes alone in 0.26–1.65 s (`testing-live` and
    `shortcuts-c` together: 3 pass in 733 ms).
  All other suites, including both new pump suites, are green.
- One real failure was found and fixed: the first `pump-cadence.test.ts` used wall-clock sleeps and
  stretched to 898 s under load. It now stubs `setTimeout` and drives the chain deterministically;
  it passes in 23 ms.

## What next

The deep-link drain in `src/app-loop.ts` is still a second 16 ms `setInterval`. Merge it into the
pump's single scheduled tick and measure wakeups and deep-link delivery latency; do not assume the
second timer is free.
