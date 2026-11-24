# Brief: the 16 ms AppKit pump

Source: `docs/reviews/perf/04-parity.md` §1 "What runs per frame" and the transfer table row 1. The
finding is structural: `PUMP_INTERVAL_MS = 16` (`src/app-types.ts:117`) drives a self-rearming
`setTimeout` (`src/platform/darwin/pump.ts:34-48`, `src/platform/darwin/platform.ts:77-82`), and every
tick builds autoreleased `NSDate`/`NSEvent`/`NSString`/`NSValue`, calls
`nextEventMatchingMask:…` with a 4 ms deadline, then `sendEvent:` and `updateWindows`
(`src/platform/darwin/shim/50_app.c:72-77`, `:84-109`). A second 16 ms `setInterval` drains deep links
(`src/app-loop.ts:131-140`). Tauri runs tao's native event loop instead and has no repeating JS timer
doing AppKit work.

## Own

- `src/platform/darwin/pump.ts`, `src/platform/darwin/platform.ts`,
  `src/platform/darwin/shim/50_app.c`, `src/app-types.ts`, `src/app-loop.ts`, plus their tests.
- A new worktree: `~/dev/worktrees/crust/perf-pump`, branch `perf/pump`.

Nothing else. Do not touch `scripts/perf/**`, `src/bridge/**`, `src/perf/**`, or another lane's worktree.

## Measure first, and report the number even if you change nothing

Establish, on this machine, with the labels `measured`:

1. **Cost of one tick.** Instrument the pump temporarily (a counter and a monotonic sum, guarded so it is
   off by default) and print mean/p95 tick duration and ticks/second over 10 s with the bridge idle and
   with a 60 fps canvas animation running. That tells us whether the pump costs 0.2 ms or 4 ms per tick —
   they imply completely different fixes.
2. **Process CPU at idle** for a built app doing nothing, over 10 s (`ps -o time=`/`pcpu` sampled twice, or
   `top -l 2` second sample — the first sample is a lifetime average and is not valid).
3. **Frame-time p95** of the animating probe page from the page's own `requestAnimationFrame` deltas.

Then change something, re-measure the same three, and report before/after as a table. If the numbers say
the pump is not the problem, say so and stop — a wrong structural fix costs more than a missing one.

Record `sysctl -n vm.loadavg` and the `bun` process count before and after every run, label any run over
2.0 `contaminated`, interleave A/B arms rather than batching, and keep a same-flag-vs-itself control row
as the noise floor.

## Candidate fixes, in order of preference

Pick by what the measurement says, not by this list:

1. **Stop allocating per tick.** Hoist the `NSDate` and any constant native object out of the loop; use a
   `distantFuture`/precomputed date where the deadline only needs to be "now plus 4 ms".
2. **Pump only when there is work.** A dirty flag set by whatever needs AppKit serviced; idle ticks return
   immediately without touching the run loop. Skipping `updateWindows` when nothing is dirty is the direct
   win, because that call is the expensive one.
3. **Adaptive interval.** Idle at a slower cadence (e.g. 100 ms) and tighten to 16 ms while a window is
   resizing, a menu is tracking, or a modal is up. Any adaptive change must have a test that proves
   interactivity is not degraded: a menu opens, a window drag tracks, a modal appears.
4. **Merge the two 16 ms timers** (`pump.ts` and the deep-link drain in `app-loop.ts`) into one scheduled
   tick so the process wakes once per frame instead of twice.

What is **not** on the table: calling into Bun's FFI from a background thread. `bun:ffi` callbacks run on
the JS thread; a native timer invoking a JS callback off-thread is a crash, not an optimisation.

## The regression that would make this a net loss

Responsiveness. A lazier pump that makes a menu open 200 ms late is worse than a hot core. So every
candidate must show, after the change:

- `bun run e2e:window` and `bun run e2e:preview` green, plus the e2e that owns any path you touched.
- One interactive proof, described in the report with its command: a menu opens, a drag tracks, a window
  opens. Screenshot only through `window.capture`, `testing.activation: "none"`.

## Constraints

- Files ≤ 200 lines. Gate: `bun check`, `bun run test`, `bun run test:no-skips`, `bun run check:lines`.
- Every probe ≤ 15 s; process count before/after; kill by recorded PID in a trap covering success, error,
  timeout and SIGINT; fail the run if the after-count exceeds baseline. No leaked app processes.
- No OS screenshot, no focus theft.
- `rg` not `grep`, `fd` not `find`, never scan from `/` or `~`.

## Report

`docs/reviews/perf/05-pump.md`: the three measurements before, the change made (or why none was), the same
three after, the interaction proofs, the gate output, and one line on what you would attack next.
