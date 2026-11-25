# Brief: latency, the axis that makes an app feel slow when fps is fine

Measured so far, on this machine: idle 54.6 fps, one invoke/second free, invokes at 200/s free, a 30 Hz
event stream inside the noise floor, and every per-invoke and per-event arm within the self-control spread
(`01-baseline.md`, `07-page-invoke.md`). So crust does not lose frames to its bridge. The pump was
blocking 6.8 ms of each 16 ms budget and lane E cut that to 2.7 ms.

What has **not** been measured is latency: how long the user waits for the app to respond. An app at 60 fps
still feels broken when a keystroke takes 300 ms to appear or a window takes a second to show.

## Own

- `scripts/perf/interaction.ts` and `examples/perf-interaction/` (new), plus
  `docs/reviews/perf/08-latency.md`.
- A new worktree: `~/dev/worktrees/crust/perf-latency`, branch `perf/latency`.

Measure and report; change source only where a number is clearly crust's, and then only in files no other
lane holds (`src/app-loop.ts`, `src/platform/darwin/pump.ts` are lane E's — coordinate through me, do not
edit them).

## The six numbers

Each is a distribution (p50/p95/max) over at least 50 samples, measured from the page's own clock, with the
event that starts it and the paint that ends it both observable:

1. **Keystroke to painted glyph.** Dispatch a key into a focused input from the page, time until the
   character is in the DOM *and* the next frame has been presented.
2. **Click to handler.** The gap between the input event and the page's handler running, which is what a
   blocked main thread stretches.
3. **Scroll.** Frames drawn and frame time while a scripted scroll of a tall list runs for 3 s; report
   frames dropped.
4. **Window open to first paint.** `window.create` → the page's first `requestAnimationFrame` in the new
   window. This is the number a user reads as "slow app".
5. **Resize.** Frames drawn during a scripted 20-step resize; a resize that repaints once at the end is
   fine, one that stutters is not.
6. **Launch to interactive.** Process start → the page's `document.readyState === "complete"` and first
   frame. Report it as wall time, and break it into build-independent segments if you can.

Then, if the numbers allow, a 7th: **menu open**. Time from the page's `menu.show` invoke to the native bar
being present, which is main-thread bound and may be the worst of the six.

## Method

- The probe window must not be occluded or the page draws nothing: disable occlusion detection in the
  probe's own scaffolding, keep it out of shipped code, and fail the run when frames drawn is zero.
- Record `sysctl -n vm.loadavg` and the `bun` process count before and after every run, label runs over 2.0
  `contaminated`, interleave repeated arms, and keep a same-arm control row — the control spread has already
  swallowed a 3 fps "win" in this programme and it will swallow a 20 ms one next.
- A single 317 ms outlier was observed in another lane and traced to external suspension. Report outliers
  and say what you suspect; never silently trim one.
- Probes ≤ 15 s, kill by recorded PID in a trap covering success, error, timeout and SIGINT, fail when the
  after-count exceeds baseline. No OS screenshot, no focus theft, `window.capture` only.
- `rg` not `grep`, `fd` not `find`, never scan from `/` or `~`. Files ≤ 200 lines.
- Gate: `bun check`, `bun run test`, `bun run test:no-skips`, `bun run check:lines`, `bun run e2e:single`.

## Report

`docs/reviews/perf/08-latency.md`: the six (or seven) distributions as a table sorted worst-first, the load
labels, the one that would most change a user's impression, and for each a one-line cause hypothesis marked
as hypothesis — not as fact.
