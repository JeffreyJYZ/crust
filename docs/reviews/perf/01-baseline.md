# Perf baseline, lane A — measured on this machine

**Verdict: contaminated, indicative, not a clean baseline.** One-minute load was **4.27 measured**
at the start and **4.08 measured** at the end, above the 2.0 limit in `docs/plan/perf/BRIEF.md`.
Sibling lanes were building and running suites. Do not present these numbers as a clean-machine
baseline or as a cross-branch win.

Usable sample: `docs/reviews/perf/baseline-final-occlusion.json`.
Harness: `scripts/perf/measure.ts`, `scripts/perf/in-process.ts`, `scripts/perf/conditions.ts`,
`scripts/perf/compare.ts`, `scripts/perf/perf-native.c` + `perf-native.ts`.
Probe app: `examples/perf-probe/` (`crust.config.ts`, `main.ts`, `public/workload.js`, `public/app.js`).

## Three arms, occlusion disabled

Fixed workload: **60 measured** DOM rows rendered and **200 measured** canvas rects repainted per
tick, three consecutive **3000 ms measured** windows. Every number below is `measured` from the
labelled JSON; derived values say `derived`.

| Arm | fps | frame p50 | frame p95 | frames drawn | long tasks >50 ms | long frames | invokes | events | load start → end | bun start → end |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bridge idle | 54.59 | 22.00 ms | 25.00 ms | 164 | 0 | 0 | 0 | 0 | 4.27 → 4.08 | 2 → 2 |
| one invoke/second | 54.56 | 23.00 ms | 25.00 ms | 164 | 0 | 0 | 2 | 0 | 4.27 → 4.08 | 2 → 2 |
| sustained invoke + 30 Hz SSE | 40.74 | 24.00 ms | 26.00 ms | 123 | 0 | 0 | 275 | 83 | 4.27 → 4.08 | 2 → 2 |

All rows are `measured`. `longtask` observer was supported and reported **0 measured** entries in
every arm. Worst long-task count: **0 measured**. No arm had fewer than 100 frames drawn.
Driver was `requestAnimationFrame` for the first two arms and backend-paced invokes for the third;
the third is a bridge-load arm, not a compositor-only fps arm.

The event stream is real: backend emitted **83 measured** `perf:tick` frames at **30 Hz measured**,
page received them, and **275 measured** invokes crossed the bridge. Event cost is now measured.

Heap: page `performance.memory` is **absent measured** in WKWebView, so page heap is `null`.
Proxy at report time on the Bun backend: **5,325,153 bytes heapUsed measured**,
**65,307,968 bytes RSS measured**; neither is webview heap.
`window.capture` (crust's own capture, no OS screenshot): **ok measured**, **1800×1280 measured**
at **scale 2 measured**, **146,752 base64 bytes measured**.

## Occlusion scaffolding — dev only

`testing.activation: "none"` is correct for no focus theft but leaves the window occluded, and
WebKit then suspends rAF: the earlier run reported `visibilityState=hidden` and **0 frames**. That
arm was a failed measurement, not a slow app. The scaffold now applies, before the first page
evaluate:

- `-[WKWebView _setWindowOcclusionDetectionEnabled:NO]` — **private WebKit SPI, harness
  scaffolding only, never a shipped default.** Occluding a background window is correct battery
  behaviour. This is why the field `occlusionDetection: false` is in the sample.
- public `NSWindow setCollectionBehavior:` = 1 (`canJoinAllSpaces`) so the page renders on the
  active Space without activating the app;
- public `NSProcessInfo beginActivityWithOptions:` held for the process lifetime to defeat App Nap.

The run logged `occlusionDisabled=true`, `keepAwake=true`, `occlusionState=8192`, page
`visibilityState=visible`. The raw AppKit state still reads occluded, but WebKit detection is off,
so rAF ran. Each level records its own `occlusion` object. The harness **fails loudly and writes no
sample** when any arm draws zero frames or fps < 10.

Superseded samples kept as diagnostics, not data:
`baseline.json` (occlusion on, one 0-fps arm), `baseline-final.json` (occlusion on, two arms),
`baseline-occlusion.json` (checkpoints ended the run early), `baseline-occlusion2.json`
(double-driven workload inflated the third arm to 96 fps). None is comparable to the usable sample.

## Process and focus safety

Probe-scoped `bun`/app processes: **0 before, 0 after, 0 new measured**, leak gate **PASS measured**.
Global `bun` processes: **2 before, 2 after measured**. This harness is in-process, so it spawns no
long-lived child; cleanup runs from `finally` and from an exit/SIGINT/SIGTERM/SIGHUP trap. No OS
screenshot, no activation, no cursor movement. Probe wall time **9.6 s derived** from JSON
timestamps, within the 15 s cap.

## Lane E context — do not claim a win

Lane E measured each pump tick blocking **6.8 ms of the 16 ms budget** and cut it to **2.7 ms**.
That change has not landed in this worktree. Any `--label after` run taken before it merges would
compare against a slower baseline than the one we will ship, so a cross-branch delta here is not a
win. The clean pass belongs on merged main, interleaved with a same-flag-vs-itself control row.

## Commands

Run from `~/dev/worktrees/crust/perf-baseline`, branch `perf/baseline`:

```
bun check
bun run test
bun run check:lines
bun run e2e:single
bun run scripts/perf/measure.ts measure --label baseline-final-occlusion
bun run scripts/perf/measure.ts compare baseline-final-occlusion baseline-final-occlusion
```

The build command for the standalone probe app is
`bun run src/cli/index.ts build --dir examples/perf-probe`; the in-process harness serves
`examples/perf-probe/public` directly and needs no build step.

## Gate results

`bun check` PASS (1,241 files). `bun run check:lines` PASS. `bun run e2e:single` PASS, 27/27
assertions in 5.8 s. `bun run test` FAILED while sibling lanes held load at 3–5:
`scripts/butter-sweep.test.ts` reported a frontmost-lost AX answer twice, and
`src/plugins/stronghold-concurrency.test.ts` timed out inside the 600 s chain. Retrying the
latter alone passed 4/4 in 543 ms. Neither failure touches the harness or probe app. All four
gate commands were run; no suite was re-run after a genuine regression.

## One number to attack first

**40.74 fps measured** under sustained invokes plus 30 Hz SSE, down from **54.59 fps measured**
idle — a **13.85 fps derived** drop at load 4.27. Attack the bridge-load path after lane E lands,
not this contaminated cross-branch sample.
