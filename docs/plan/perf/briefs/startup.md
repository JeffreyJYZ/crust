# Brief: launch to interactive, the 634 ms

`docs/reviews/perf/08-latency.md` measured **634 ms p50 from process start to an interactive page** (n=10),
with one 2603 ms outlier behind a load spike. Keystroke→paint 22 ms, resize 2 ms, click→handler at the
probe floor, scroll inconclusive. So startup is now the whole remaining complaint: an app that opens in
634 ms feels slow before it has drawn anything, and no amount of frame-rate work touches it.

## Own

- `src/app.ts`, `src/app-loop.ts`, `src/cli/dev.ts` and the startup path in `src/runtime*.ts`, plus tests.
- `scripts/perf/startup.ts` and `docs/reviews/perf/10-startup.md`.
- A new worktree: `~/dev/worktrees/crust/perf-startup`, branch `perf/startup`.

Do not touch `src/platform/darwin/shim/50_app.c` or `pump.ts` (lane E's, already merged) or `src/perf/**`.

## First: decompose it, because six candidates are plausible and only one is big

Measure the segments, each timestamped from the app's own launch, over at least 10 launches:

1. process start → first crate of crust's runtime running
2. runtime init → native window created
3. window created → `WKWebView` configured
4. webview configured → first navigation committed (page request answered)
5. navigation → `document.readyState === "complete"`
6. complete → first `requestAnimationFrame`

Add a 7th if a segment is obviously dominant: the bundle's own prelude (how much JS is parsed before your
first line runs), and whether any blocking file I/O happens on the launch path (log file open, store load,
config read, keychain).

Report the segments as a stacked table summing to the total, so a 400 ms segment cannot hide inside "init".

## Then cut the dominant one

Rules for the fix:

- It must not change app-visible behaviour. Same window appears, same page loads, same first frame.
- A lazy load is the likely win: anything crust does at startup that could happen on first use instead. Name
  what you moved and what now pays for it.
- If the bundle prelude is dominant, say so with the byte count — that is a build-time fix, not a runtime one.
- Anything that shortens startup by making the first paint wrong is refused: no blank frame, no deferred
  window creation that the app can observe.

## Method

- Record `sysctl -n vm.loadavg` and the process count before and after every launch, label runs over 2.0
  `contaminated`, and interleave before/after launches rather than batching them — startup is the most
  load-sensitive number measured so far and the outlier above proves it.
- Probes ≤ 15 s each, killed by recorded PID in a trap covering success, error, timeout and SIGINT, no leaked
  app processes, no OS screenshot, no focus theft.
- `rg` not `grep`, `fd` not `find`, never scan from `/` or `~`. Files ≤ 200 lines.
- Gate: `bun check`, `bun run test`, `bun run test:no-skips`, `bun run check:lines`, `bun run e2e:single`.

## Report

`docs/reviews/perf/10-startup.md`: the stacked segment table before, the change, the same table after, the
launch p50/p95 before and after with the control row, and one sentence on what a user will notice.
