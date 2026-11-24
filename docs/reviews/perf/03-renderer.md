# Lane C — renderer / WKWebView configuration perf review

Verdict: **no config flag produced a measurable frame-rate win.** Every flag delta sat inside the
same-flag-vs-itself noise floor. No product change was made. The only large delta in this lane was
a private WebKit selector needed to make rAF run at all in a headless probe; I refuse to ship it.

- **Biggest measured delta:** 0 fps to ~56 fps from `_setWindowOcclusionDetectionEnabled:NO` in the
  harness — a private selector, scaffolding only, **not shippable**. Among shippable flags the
  largest observed delta was -3.02 fps for `layerContentsRedrawPolicy=3`, inside the 8.53 fps
  self-control spread, so noise.
- **Flags that did nothing:** `drawsBackground=NO`, `windowOpaque=NO`, `wantsLayer=NO`,
  `layerContentsRedrawPolicy=0` and `=3`, `suppressesIncrementalRendering=YES`, and a fresh
  `WKProcessPool`. All kept frame time at 21–24 ms p50 / 26 ms p95, identical to baseline.

## Report path

`docs/reviews/perf/03-renderer.md` (this file). Raw logs: `docs/reviews/perf/renderer-run5.log`,
`docs/reviews/perf/config-run1.log`. Scratch harness: `scripts/perf/`.

## Method

- One `DarwinPlatform` with `activate: "never"`, every window `activate: false`,
  `setTestingActivation("none")`. No OS screenshot. No focus theft — `probe-run` captured and
  restored `ghostty -> ghostty` on every probe.
- Page: fixed canvas workload (clear + 80 filled rects) on `requestAnimationFrame`; deltas read
  from the page with `window.__stop()` through `testing.evaluate`. fps = frames / wall seconds,
  p50/p95 from the deltas in the page itself.
- Seven arms, **interleaved** A/B/A/B… over five rounds, 2 s per run (well under the 15 s cap).
- Every sample records `sysctl -n vm.loadavg` and `pgrep -x bun | wc -l` before and after.
  Runs with 1-min load > 2.0 are flagged `contaminated` — all of them were: sibling lanes held
  load at 3.4–6.5 and 10–26 `bun` processes throughout. **No number here is a clean-machine
  measurement.**
- Noise floor: the `baseline-self` arm, identical to `baseline`, measured in the same interleaved
  rounds. Its spread was 8.39 fps; `baseline` spread 8.53 fps. Any delta under ~8.5 fps is noise.
  A real delta under 2 fps would be `not-worth-shipping`.
- Process gate: wrapper recorded the `bun` count before/after and killed the child PID in a trap
  on EXIT/INT/TERM. `probe-run` handed focus back. The count changes are sibling traffic, not leaks
  from this harness (it spawns no long-lived child of its own).

## Harness findings that had to be fixed before any data meant anything

1. **Under `testing.activation: none` rAF is suspended completely** — 0 frames in 2.5 s. No fps
   comparison is possible without changing WebKit's occlusion behaviour in the harness.
2. **`-[WKWebView _setWindowOcclusionDetectionEnabled:NO]`** (private WebKit SPI, guarded by
   `respondsToSelector:`) restores rAF to ~56 fps. It must be applied **before the first page
   evaluate**; applied later WebKit keeps rAF suspended and every arm reports 0. The window also
   needs public `setCollectionBehavior:` = 1 (`canJoinAllSpaces`) so it renders on the active Space
   without activating the app.
3. **App Nap must be held off for the process lifetime** via public
   `NSProcessInfo beginActivityWithOptions:` (`UserInitiated | LatencyCritical`). Ending the
   activity immediately let rAF collapse to ~7 fps roughly 30 s into a run — two whole runs were
   discarded for that reason.
4. Even with all three, external occlusion still suspended rAF in round 4 of run5; those samples
   were filtered as contamination, not attributed to any flag.

### Private selectors I would refuse to ship

- `_setWindowOcclusionDetectionEnabled:` — **refuse.** Unsupported WebKit SPI: no ABI stability,
  likely App Store rejection, and it changes WebKit's visibility semantics for every page. It is
  harness scaffolding only, constant across all arms.
- `setValue:forKey:` KVC writes of `pageVisibilityBasedProcessSuppressionEnabled` /
  `hiddenPageDOMTimerThrottlingEnabled` — **refuse to probe or ship.** Unknown KVC keys raise
  `NSUnknownKeyException`; there is no safe `respondsToSelector:` pre-check for a KVC key, so a
  wrong name crashes the probe process. The occlusion selector alone was enough to unblock rAF.
- `setValue:forKey: drawsBackground` is already used by crust for material windows and is not
  private in the same risk class; it was measured as a normal arm below.

## Flag table — live window / webview flags

From `renderer-run5.log`. `delta` is versus `baseline` median fps.

All 35 samples (includes the externally-suspended round 4):

| arm | n | fps p50 | spread | p50 ms | p95 ms | delta fps | verdict | contaminated |
|---|---:|---:|---:|---:|---:|---:|---|---:|
| baseline | 5 | 57.96 | 38.83 | 23 | 26 | 0 | control | 5/5 |
| baseline-self | 5 | 51.45 | 15.17 | 22 | 26 | -6.51 | control | 5/5 |
| drawsBackground=NO | 5 | 55.94 | 35.78 | 23 | 26 | -2.02 | noise | 5/5 |
| windowOpaque=NO | 5 | 57.50 | 37.99 | 23 | 26 | -0.46 | noise | 5/5 |
| wantsLayer=NO | 5 | 57.47 | 39.99 | 23 | 26 | -0.49 | noise | 5/5 |
| redrawPolicy=0 | 5 | 54.50 | 37.94 | 24 | 26 | -3.46 | noise | 5/5 |
| redrawPolicy=3 | 5 | 52.45 | 41.50 | 23 | 26 | -5.51 | noise | 5/5 |

Externally-stalled samples removed (fps < 45 or p95 > 60 ms), 25 samples kept:

| arm | n | fps p50 | spread | p50 ms | p95 ms | delta fps | verdict | contaminated |
|---|---:|---:|---:|---:|---:|---:|---|---:|
| baseline | 4 | 57.96 | 8.53 | 23 | 26 | 0 | control | 4/4 |
| baseline-self | 4 | 56.49 | 8.39 | 24 | 26 | -1.47 | control | 4/4 |
| drawsBackground=NO | 4 | 55.98 | 2.34 | 23 | 26 | -1.98 | noise | 4/4 |
| windowOpaque=NO | 4 | 57.91 | 4.52 | 23 | 26 | -0.05 | noise | 4/4 |
| wantsLayer=NO | 3 | 58.49 | 1.50 | 21 | 26 | +0.53 | noise | 3/3 |
| redrawPolicy=0 | 3 | 56.44 | 4.44 | 23 | 26 | -1.52 | noise | 3/3 |
| redrawPolicy=3 | 3 | 54.94 | 8.03 | 23 | 26 | -3.02 | noise | 3/3 |

Frame-time p50 and p95 are 21–24 ms and 26 ms in **every** arm. Nothing moved frame timing;
only aggregate fps wobbled with machine load.

## Config flags (copied at webview creation)

From `config-run1.log`. Fresh window per run (the config is copied when WebKit builds the webview),
five runs per arm, interleaved for the first two arms. `freshProcessPool` cannot be unset on a live
config, so it ran last — its comparison is weaker and is marked as such.

| arm | n | fps p50 | spread | p50 ms | p95 ms | delta fps | verdict |
|---|---:|---:|---:|---:|---:|---:|---|
| config-default (control) | 5 | 55.36 | 5.49 | 23 | 26 | 0 | control |
| suppressesIncrementalRendering=YES | 5 | 56.44 | 4.10 | 23 | 26 | +1.08 | noise (<2 fps, inside spread) |
| fresh WKProcessPool | 5 | 56.45 | 6.00 | 23 | 26 | +1.09 | noise (<2 fps, inside spread) |

Load during this pass: 2.39–14.16 on the 1-min average; 22–30 `bun` processes. `config-default`
and `suppressesIncremental` were interleaved arm by arm; both sat at 23 ms p50 / 26 ms p95.
Media autoplay and further preference KVC keys were not probed: media playback is not in the fixed
canvas workload, and the KVC keys are private with an unsafe failure mode (see refusals above). They
have no measured path to per-frame cost in this workload, so no claim is made about them.

## Implementation decision

None. No measured delta exceeded the same-flag noise floor, so there is no safe change to make
behind existing config. `src/**` is untouched in this worktree; only `scripts/perf/**` and this
report were added.
