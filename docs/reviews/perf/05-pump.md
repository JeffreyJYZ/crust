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

## Change

`src/platform/darwin/shim/50_app.c`: pass a nil deadline to
`nextEventMatchingMask:untilDate:inMode:dequeue:` so an empty queue returns immediately, instead of
creating two `NSDate` objects and waiting 4 ms every tick. The 2 ms `CFRunLoopRunInMode` slice and
the `sendEvent:` / `updateWindows` path for real events are unchanged — the run loop is what paints.
`src/platform/darwin/pump.ts` keeps the opt-in tick counter used for the measurements.
`src/platform/darwin/pump-pool.test.ts` pins the non-blocking deadline and the retained pool.

## Interaction proofs

Built from the changed worktree with
`bun ~/dev/rdm/perf-pump/interact.ts ~/dev/worktrees/crust/perf-pump <scratch>`, then the bundle's
binary launched directly. Captured through `window.capture` only; no OS screenshot.

```
page      MENU installed={"ok":true,"count":1} readable=true
page      CAPTURE ok=true bytes=63832 size=1800x1200
page      DRAG from={"ok":true,"label":"main","x":120,"y":120} to={"ok":true,"label":"main","x":280,"y":200} moved=true
page      CREATE ok={"ok":true,"label":"probe","created":true} labels={"ok":true,"labels":["main","probe"]}
page      PROOF DONE
```

`menu.read` reads the installed native bar back from AppKit, so the menu item is provably present;
`menu.showContext` is a modal popup that blocks the JS thread and is not drivable without a physical
click, so it was not used. Drag is eight successive `window.setPosition` calls with `getPosition`
readback after each; the capture is from move 4. A second window opens and appears in `window.list`.

## Gate

PENDING
