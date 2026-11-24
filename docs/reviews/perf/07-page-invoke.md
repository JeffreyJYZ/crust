# Lane H — the page side of an invoke, split

**Verdict: none of the three traffic paths is expensive. No product fix.** Invokes at 30/s and
200/s, SSE events at 30 Hz and 120 Hz, and both together all sit inside the idle/self-control spread.
The 13.85 fps lane A reported is reproducible only by reproducing **lane A's driver** — a sequential
16 ms backend `pace` with the page's paint work done in each reply callback. That is a measurement
artefact, not bridge traffic. Every number below is `measured` from this worktree's JSONL; derived
values say `derived`.

## Premise correction

The brief's "212 ms frame-time p95 with 8 long frames" is **not in any committed report**. The
committed baseline (`docs/reviews/perf/01-baseline.md:19-23`) records 25/26 ms p95 and **0 long
frames** in all three arms; its superseded occluded samples reported 0 fps, not 212 ms. The 212 ms
tail is the occluded-window artefact and is struck here. The number actually owned is **13.85 fps**
(`01-baseline.md:106-108`): 54.59 fps idle versus 40.74 fps under a combined invoke+event arm with a
different driver.

## Method and safety

- Probe: `docs/reviews/perf/pageinvoke/probe.ts`; page: `.../public/{index.html,bench.js}`. Real
  bridge, real window, page-owned rAF deltas and `performance.now()` — no backend clock in any frame
  number. Raw samples: `.../round-{0,1,2}.jsonl`.
- Occlusion: private `-[WKWebView _setWindowOcclusionDetectionEnabled:NO]` from
  `scripts/perf/perf-native.ts` applied **before first evaluate**, `setCollectionBehavior:` = 1,
  `NSProcessInfo` keep-awake held for the process lifetime. Dev-only scaffolding, never shipped.
  Every arm records `visibilityState`; zero frames or `hidden` is a hard failure. All 30 arm samples
  report `visible` and ≥31 frames drawn.
- Arms interleaved inside each round with two idle controls (`idle`, `idle-self`); three rounds.
  700 ms per arm, 10 arms per process, ~12 s wall, under the 15 s cap. One process per round so a
  transport death costs one JSONL line. `probe-run` restored `ghostty` on every round.
- Conditions: `sysctl -n vm.loadavg` and `pgrep -x bun` at both ends of every arm.
  **Every round was contaminated**: 1-min load 3.15–4.38, bun count 8–17, sibling lanes active.
  No number here is a clean-machine measurement; the A/B shape is still reported with its paired
  control.
- External suspension filter: one `both-A` sample drew 9 frames with a 317 ms p95 at load 3.67;
  filtered as external occlusion, not attributed to the bridge. 1 of 30 arm samples removed.
- Process gate: in-process harness, no child spawned; bun counts before → after per round were
  16→14, 14→9, 8→8. Decreases are sibling traffic, not leaks.

## Split — the number the user feels

Medians over 3 rounds (2 valid for `both-A`), 700 ms per sample. `inv`/`evt` are counts delivered in
one window, read from the page's own counters.

| Arm | Rate | inv / window | evt delivered | fps median | frame p50 / p95 | long frames >50 ms | long tasks | contaminated |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| idle | none | 0 | 0 | 60.00 | 22–23 / 26 ms | 0 | 0 | 3/3 |
| idle-self (control) | none | 0 | 0 | 62.86 | 22–23 / 26 ms | 0 | 0 | 3/3 |
| invokes only | 30/s | 21 | 0 | 62.86 | 23 / 25 ms | 0 | 0 | 3/3 |
| invokes only | 200/s | 97–99 | 0 | 62.86 | 23 / 25 ms | 0 | 0 | 3/3 |
| events only | 30 Hz | 0 | 20 | 55.71 | 23 / 25 ms | 0 | 0 | 3/3 |
| events only | 120 Hz | 0 | 61 | 61.43 | 21–23 / 25 ms | 0 | 0 | 3/3 |
| both (A's rates) | ~90/s + 30 Hz | 54 | 21 | 65.71 | 22 / 27 ms | 0 | 0 | 3/3 |
| lane A's paced driver | ~44/s sequential | 31 | 0 | **44.29** | 25 / 26 ms | 2 | 0 | 3/3 |

Paired delta against the nearest idle sample in the same round (`derived`):

| Arm | round 0 | round 1 | round 2 |
|---|---:|---:|---:|
| invokes 30/s | +2.86 | +4.29 | +5.71 |
| invokes 200/s | +4.29 | +2.86 | +5.71 |
| events 30 Hz | −1.43 | −2.86 | −1.43 |
| events 120 Hz | 0.00 | −4.29 | +14.29 |
| both | filtered | −4.29 | +17.14 |
| lane A's paced driver | **−12.86** | **−21.43** | **−4.29** |

The idle-versus-idle-self spread reached **17.14 fps** under load, so the traffic deltas — all under
6 fps except the one filtered stall — are noise. The paced arm is 44.29–47.14 fps in **every**
round while every traffic arm is 55.71–65.71 fps.

### What lane A's arm actually did

`examples/perf-probe/public/app.js:36-48` sets `manualDrive = true`, then awaits a `perf.pace(16)`
invoke and calls `workDirect()` in each reply. The same 60-row/200-rect paint is therefore driven by
one serialized invoke every ~16 ms plus its round trip, not by `requestAnimationFrame`. My
`laneA-paced` arm reproduces exactly this shape (`bench.js:pumpManual`, backend `pace` with
`Bun.sleep(16)`): 31–32 work frames per 700 ms versus ~42 rAF frames for idle. The missing frames
are the pacing delay, not time spent in the bridge. Each of those invokes still costs ~6.5 µs on
the backend (`02-hotpaths.md:33`) and the same sub-millisecond page work as the 200/s arm.

## Page-side decomposition

All rows `measured` in the page's own clock, batched (WKWebView clamps `performance.now()` to 1 ms)
and reported as µs/op; round 0, load 3.91, contaminated.

| Operation | p50 | p95 |
|---|---:|---:|
| `JSON.parse` small boolean object | <1 µs | <1 µs |
| `JSON.parse` 4 KB / 200-key object | 20 µs | 20 µs |
| `JSON.parse` 1 MB base64 envelope | 40 µs | 100 µs |
| `JSON.stringify` 1 MB base64 envelope | 60 µs | 60–80 µs |
| `CustomEvent` dispatch to 10 listeners | <1 µs | <1 µs |

End-to-end invoke round trips from the page (10 concurrent calls, p95): small **4 ms**, medium
**4 ms**, 1 MB binary **87–94 ms** at load 3.9. The binary tail is the `atob` +
`Uint8Array.from` revive at `src/bridge/client/invoke.ts:79-81` plus the 1 MB stringify/parse; it is
real, but no arm in the split sends 1 MB results, so it is not the source of the 13.85 fps. The
event relay (`install.ts:82-100`, `content-world-source.ts:39-47`) parses one small frame and copies
a listener set per event; at 120 Hz its per-event cost stayed below the page clock's resolution.

## Fix decision

**None.** The brief's rule was to fix only the expensive path; there is none among invokes, events,
or both. The one expensive arm is a harness driver with a deliberate 16 ms backend sleep. Changing
`src/bridge/client/**` to shave sub-microsecond work would not move any measured frame number, and a
"fix" with no before/after frame delta would be a story, not a result.

If a future arm does put the cost on the event path, the file:line to open first is
`src/bridge/client/install.ts:82-100` (`dispatch`: `Array.from(set)` per frame, `decode` JSON parse)
and the isolated-world relay at `src/platform/darwin/content-world-source.ts:39-47` (per-frame
`JSON.stringify`/`CustomEvent`), with the unbatched emitter at `src/bridge/server/events.ts:90-102`.
None of those moved a frame in this run.

Lane E's pump cut (6.8 ms → 2.7 ms per 16 ms tick, `05-pump.md`) is in this tree and applies equally
to every arm, so it cannot explain a difference between them. It remains a plausible explanation for
part of the absolute gap between lane A's idle fps and a perfectly smooth 60 fps, but that is lane
E's measurement to own.

## Gates

Runner and full logs: `docs/reviews/perf/pageinvoke/gate.sh` and `*.log` beside it.

| Command | Result |
|---|---|
| `bun check` | PASS, exit 0 |
| `bun run test` | FAIL, exit 1 — 2960 pass / 1 fail |
| `bun run test:no-skips` | FAIL, exit 1 — 2959 pass / 2 fail |
| `bun run check:lines` | PASS, exit 0 |
| `bun run e2e:single` | PASS, exit 0 |

Failing tests: `scripts/butter-sweep.test.ts:121` (frontmost-lost AX answer: expected `detail: "ok"`,
received `undefined`) in both runs, and `src/platform/darwin/native-setters.test.ts` tooltip case
(342 s) in `test:no-skips`. Both reproduce when run alone on this checkout, with
`frontmost after sweep child: ghostty` and load above 2.0. Neither file is in this lane's
ownership and no `src/**` file changed here — the graph of failures is focus/load, not the probe.

Only report/probe artifacts were added; no `src/**` file changed in this lane.

## Reproduce

```
cd ~/dev/worktrees/crust/perf-pageinvoke
probe-run -c 'bun docs/reviews/perf/pageinvoke/probe.ts 0'
probe-run -c 'bun docs/reviews/perf/pageinvoke/probe.ts 1'
probe-run -c 'bun docs/reviews/perf/pageinvoke/probe.ts 2'
```
