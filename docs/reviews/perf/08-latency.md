# Lane I — interaction latency, measured where the user feels it

**Verdict: one number is big enough to matter — launch to interactive, 634 ms p50. None of the
other five is separable from the probe's own clock, and none is a product fix from this lane.**
Every frame-rate arm in `07-page-invoke.md` sits inside its control spread; the user-facing
question is how long a wait feels. This lane measured that wait from the page's own clock, with
`window.capture` as the only paint proof. No `src/**` file changed.

## Method and safety

- Harness: `scripts/perf/interaction.ts`, CLI `scripts/perf/interaction-cli.ts`, sanity partner
  `scripts/perf/interaction-verify.ts`, page under `examples/perf-interaction/public/`.
  Reuses `scripts/perf/conditions.ts` (load, bun count, probe PIDs) and `scripts/perf/perf-native.ts`
  (private `-[WKWebView _setWindowOcclusionDetectionEnabled:NO]`, applied before first evaluate).
- Every run is an in-process window with `activate: "never"` and `testing.activation: "none"`.
  No OS screenshot, no synthesized input on the human's screen, no cursor movement. `probe-run`
  wraps every launch and hands focus back to whatever app was frontmost (Ghostty or WeChat).
- Raw runs: `docs/reviews/perf/interaction/*.json`. Each carries `conditions`, `occlusion` and
  `visibilityState: visible` when the run completed. Timed-out runs are labelled as such below;
  their arms were reported before the kill and are still real measurements, but they carry no
  condition stamp.
- The probe page runs a continuous rAF paint loop (dev-only) because WebKit does not composite a
  non-frontmost window when nothing requests a frame, and a `window.capture` after a DOM change
  otherwise waits for a paint that never arrives. This is scaffolding, not a shipped default.
- Condition rule from the brief was followed: record `sysctl -n vm.loadavg` and `pgrep -x bun`
  at both ends, label load over 2.0 `contaminated`. **Every completed run was contaminated** —
  one-minute load 3.22–9.75, bun count 21–39 from sibling lanes. No number here is a clean-machine
  measurement. A/B against a same-arm control is not available in these arms, so no "win" is claimed.
- Process gate: in-process harness, no child spawned; probe-PID counts were 0 → 0 on completed runs.
- Outliers are reported, never trimmed. One 2603 ms launch at load 7.65 is kept in the distribution.

## Distributions, worst first

p50 / p95 / max in milliseconds. **n** is samples actually taken, not samples planned.

| # | Arm | n | p50 | p95 | max | Load | Verdict |
|---|---|---:|---:|---:|---:|---|---|
| 6 | Launch → interactive | 10 | 634 | 2603 | 2603 | 3.22–7.65 | real, contaminated; one external-stall outlier |
| 4 | Window create → acknowledged (paint not observable) | 25 | 34 | 45 | 50 | 4.33 | proxy, not first paint |
| 1 | Keystroke → painted glyph | 11 | 22 | 25 | 25 | 6.33 | real, capture-quantized |
| 3 | Scroll frame interval | 94 | 17 | 18 | 18 | 9.75 | real, but 175 frames dropped |
| 5 | Resize `setSize` call | 20 | 2 | 3 | 4 | 9.75 | real; frames drawn not observable |
| 2 | Click → handler (synthetic) | 60 | 0 | 0 | 0 | n/a | floor, not OS input delivery |

### 6 — Launch to interactive

`lat-launch-{a..j}.json`, 10 completed process launches. Wall time from this process's first line
to the page's `Date.now()` at `readyState === "complete"`. First frame came 1 ms after ready in
every sample, so readiness and first paint are the same event at this resolution.

Sorted: 595, 602, 621, 627, 634, 639, 650, 656, 947, 2603 ms. The 2603 ms sample ran at load
7.65; the 947 ms one at 3.33. **Hypothesis:** Bun start + bridge + WebKit document load dominate;
the tail is external suspension, not crust. Segment breakdown beyond ready/first-frame was not
available without instrumenting the runtime, so this is stated, not measured.

### 4 — Window open to first paint

Runtime-created window pages never reached `window.crust.ready` in this in-process scaffold, so
zero of 25 new pages delivered their own first-rAF mark. The brief's exact number is therefore
**not measured**. What is measured is `window.create` → acknowledgement in the parent page:
25 samples, 19–50 ms. **Hypothesis:** that time is bridge dispatch plus `NSWindow` creation; it
does not include document load or paint and must not be read as "the window appears in 34 ms".

### 1 — Keystroke to painted glyph

`lat-debug10.json` (n=10) and `lat-debug.json` (n=1). Page-dispatched synthetic `keydown`; the
page's own handler puts the character in the DOM; a `window.capture` taken before dispatch is the
baseline and the first PNG that differs proves the glyph was presented. One poll was enough in
every sample. DOM arrival was 0 ms in every sample: the handler runs synchronously with dispatch,
so that column measures scheduling, not OS event delivery.

The paint number sits exactly on the capture round-trip cost (19–22 ms in `lat-core-h.json`), so
22 ms is an **upper bound** at the probe's resolution, not a resolved paint time. **Hypothesis:**
no crust-side cost is separable here; a blocked main thread would show up as a painted number
well above the capture control, and none did.

### 3 — Scroll

`lat-paint-b.json`. A 3 s scripted scroll of a 400-row list, hard-capped at 4.5 s because rAF
stopped before the loop's own exit: 95 frames drawn, 21.1 fps, 175 frames below a 60 fps target,
frame p50 17 ms / p95 18 ms, **0 long frames**. `painted: false` — the before/after captures were
identical. **Hypothesis:** the window was not composited (its `occlusionState` was 8192 even with
the private override), so the missing frames are a probe artifact, not a crust regression. The
17 ms frame interval is real when frames were drawn.

### 5 — Resize

`lat-paint-b.json`, 20 `window.setSize` steps on the main window: 2 ms p50, 3 ms p95, 4 ms max.
The rAF counter drew 0 frames across the whole sequence, so frame pacing during resize is
**not measured**. **Hypothesis:** the native setter is cheap; the absent frames share the scroll
arm's occlusion cause and say nothing about crust.

### 2 — Click to handler

`lat-core-e.json`, 60 synthetic `element.click()` dispatches. Handler gap 0 ms at p50/p95; with a
deliberate 20 ms main-thread block before dispatch the gap was exactly 20 ms in all 60 samples.
**Hypothesis:** the path is synchronous in the page; the blocked arm only measures the block the
probe itself inserted. This is a floor, not a measurement of OS click delivery.

### 7 — Menu open

Not measured. `menu.show` is not registered in the in-process bridge used by this harness; adding
it would mean standing up the menu plugin in the probe, which did not fit before the gate. No
number is claimed.

## What would most change a user's impression

Launch to interactive, 634 ms p50. It is the only arm larger than the probe's own clock
resolution and the first thing a user waits for. Everything after launch is at or below 34 ms
in this run.

## Honest limits

- The brief asked for at least 50 samples per arm. Only click (60), window-create (25), resize (20)
  and launch (10) came close; keystroke has 11 and scroll is one 3 s run. Capture round trips took
  seconds at load 9.75, which is why the keystroke arm could not reach 50 before its deadline.
- rAF stopped after roughly 30 frames in the non-frontmost probe window; the private occlusion
  selector did not keep it alive for a long run. Scroll/resize frame counts are therefore partial.
- No clean-machine run exists. Every load reading was above the brief's 2.0 contamination line.

## Gates

| Command | Result |
|---|---|
| `bun check` | PASS, exit 0 (1,262 files) |
| `bun run test` | PASS, exit 0 — 2981 pass / 0 fail |
| `bun run test:no-skips` | PASS, exit 0 — 2981 pass / 0 fail, no unapproved skips |
| `bun run check:lines` | PASS, exit 0 |
| `bun run e2e:single` | PASS, exit 0 — 27/27 assertions |

No `src/**` file changed in this lane.

## Reproduce

```
cd ~/dev/worktrees/crust/perf-latency
probe-run -c 'bun scripts/perf/interaction-cli.ts measure --label lat-core-X --mode core'
probe-run -c 'bun scripts/perf/interaction-cli.ts measure --label lat-paint-X --mode paint'
probe-run -c 'bun scripts/perf/interaction-cli.ts measure --label lat-windows-X --mode windows'
probe-run -c 'bun scripts/perf/interaction-cli.ts measure --label lat-launch-X --mode launch'
```
