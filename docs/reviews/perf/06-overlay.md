# Lane G — profiler overlay (the half a developer looks at)

Verdict: the overlay reports the frame rate the page actually drew, and it does not cost frames.
Both deciding numbers were measured in a real WKWebView with `testing.activation: none`; neither
was inferred from a fixture or a config read.

- **Frame-rate agreement:** 60.00 vs 60.00 fps and 59.00 vs 59.00 fps, overlay against the probe's
  independent rAF counter. Worst disagreement **0.00%** against a 5% tolerance.
- **Overlay cost:** median frame-time p95 with the panel hidden 26.00 ms, shown 24.00 ms, delta
  **-2.00 ms**. The same-arm-vs-itself control spread was 1.00 ms in both arms, so the panel has no
  measurable frame-time cost; the negative delta is load noise, not a win.
- **Reflow:** `document.body.scrollHeight` and the sentinel rect were byte-identical before and
  after showing the panel.
- **Production absence:** a byte search of the production build found 0 occurrences of the marker.

Command for every number below: `probe-run -c "bun examples/perf-overlay/measure.ts"` from
`~/dev/worktrees/crust/perf-overlay`, one run, four interleaved 2.5 s arms.

## The deciding numbers, verbatim

```
conditions occlusionDisabled=true keepAwake=true activation=none
step layout answered {"height":476,"sentinel":{"top":57.203125,"left":16,"width":868}}
arm hidden overlayFps=n/a (sampler off) probeFps=108.00 p95=25.00ms frames=269 elapsed=2.55s visible=false visibility=visible
arm shown  overlayFps=60.00 probeFps=60.00 p95=23.00ms frames=149 elapsed=2.54s visible=true visibility=visible
arm hidden overlayFps=n/a (sampler off) probeFps=51.00 p95=26.00ms frames=133 elapsed=2.55s visible=false visibility=visible
arm shown  overlayFps=59.00 probeFps=59.00 p95=24.00ms frames=144 elapsed=2.55s visible=true visibility=visible
window.capture ok 1800x1280 pngChars=186112
fps check 60.00 vs 60.00 = 0.00% off
fps check 59.00 vs 59.00 = 0.00% off
median p95 hidden=26.00ms shown=24.00ms delta=-2.00ms
control spread hidden=1.00ms shown=1.00ms
verify fps within5%=true worst=0.00%
probe-run: frontmost was ghostty, restored
```

The hidden arm prints `overlayFps=n/a` because the sampler is stopped when the panel is hidden;
only the probe's independent counter measures that arm. The shown arms are the ones compared.

## Method

- One real `DarwinPlatform`, `activate: "never"`, `setTestingActivation("none")`, one local bridge.
  Occlusion detection was disabled through the private WebKit selector **in harness scaffolding
  only**, before the first page evaluate and re-asserted before every arm. No shipped default was
  changed. Without it the page reported `visibilityState=hidden` and drew zero frames — an
  occluded window, not a slow app. The panel itself would have said "no frames" in that state;
  the earlier all-zero run is preserved here precisely because it is the failure mode this lane
  must not misread as 0 fps.
- The probe's counter is a **separate** `requestAnimationFrame` loop in
  `examples/perf-overlay/public/workload.js`, with its own array and clock. It shares no state
  with `src/perf/overlay/sampler.ts`. Both compute fps as "frames in the last second over that
  second" and are read in one page evaluate at the same instant.
- Arms interleave hidden, shown, hidden, shown, 2.5 s each. Frame-time p95 comes from the probe's
  own deltas, never from the overlay, so the cost measurement cannot grade its own homework.
- No OS screenshot: `window.capture` renders the page through WKWebView. `probe-run` captured and
  restored the frontmost app (ghostty). Every probe was bounded; the process count had no new
  probe PIDs after the run.

## Production absence

`bun test examples/perf-overlay/production.test.ts`:

```
production absence: 1 file(s), 0 occurrences of "crust-perf-overlay/v1"
```

The dev bundle is asserted to contain the marker, and the production bundle is asserted not to.
`Bun.build` writes only `public/app.js` and its `workload.js` import into the production output;
the overlay entry is a separate file that production never references.

## Reflow proof

Unit level (`src/perf/overlay/panel.test.ts`) uses a DOM whose layout counts only in-flow children:
showing the panel leaves `scrollHeight` and the sentinel rect unchanged, and the panel's style is
`position: fixed` with `contain: layout style paint`. Dragging writes only `transform`, persisted
through the app's existing `crust:store`. Live level: the `step layout answered` line above is the
before value; the shown arm's `layout` was compared against it byte-for-byte and the run would have
exited 1 on any difference.

## Screenshot-equivalent proof

`window.capture ok 1800x1280 pngChars=186112` (900x640 at 2x scale), and the overlay's rendered
text as read from the live panel in that same window:

```
crust perf crust-perf-overlay/v1
frame    268 drawn · fps 57.0 · p50 22.0 p95 24.0 worst 26.0
longtask n/a in the last second
loop     p95 5.97 ms · heap 2.9/2.7 MB
events   emitted 0 · delivered 0 · dropped 0 · p95 0.00
invoke   store 1 · perf 24
```

`longtask` reads `n/a` in this WKWebView because `PerformanceObserver.supportedEntryTypes` has no
`longtask` — the contract's explicit absence case, never a fabricated zero.

## Seam with the runtime half

The merged framework exposes `window.crust.invoke`, not a `window.crust.perf` object. The overlay
therefore supplies a thin adapter in `resolvePerf()` that calls the real plugin commands —
`invoke("perf", "frameReport", frame)` and `invoke("perf", "sample")` — and uses an existing
`window.crust.perf` object instead when one is present. No command names or shapes disagreed with
`PROFILER.md`: F's `FrameStats` has `framesDrawn`, `longTasks` and the same five numeric fields,
and `sample().frame` really is `null` until a page reports. No runtime files were edited.

## Gate

- `bun check`: no type errors in 1,258 files. `bun run check:lines`: PASS, no file over 200 lines.
- Full `bun run test`: 2975 pass / 2 fail across 480 files. Both failures were outside this lane
  and focus/timing dependent: `scripts/butter-sweep.test.ts` got a `frontmost-lost` AX answer, and
  `src/plugins/testing.test.ts` `waitFor` timed out under the loaded suite. Re-running those two
  files alone gave `18 pass / 0 fail`, which is the control that makes them environmental rather
  than regressions.
- Targeted no-skip gate on the new files: `16 pass / 0 fail`, `check-skips: no unapproved skips`.
- `bun run e2e:preview`: PASS 6/6 assertions in 3.0 s (build, show, docx, hide, outside-scope, exit 0);
  `probe-run` restored ghostty. No focus theft, no OS screenshot.

## Files added

- `src/perf/overlay/sampler.ts` + test — rAF deltas, drawn-frame count, longtask `n/a`.
- `src/perf/overlay/panel.ts`, `sparkline.ts` + panel test — fixed layer, drag, 10 s canvas band.
- `src/perf/overlay/overlay.ts` + test — one sample and one frameReport per second, degraded mode,
  toggle and dev chord, production marker.
- `examples/perf-overlay/**` — config and app entry, probe page, independent counter, two build
  paths, production-absence test, capture helper and the measurement harness.
