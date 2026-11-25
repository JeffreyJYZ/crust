# Lane M — launch to interactive, decomposed

> **Correction, recorded rather than edited away.** Two rows of the stack are cost a real app never pays —
> the harness's conditions snapshot (51 ms) and its `cc` compile of the probe shim (32 ms). The honest
> app-launch figure is about **552 ms**, not 635 ms. The blank control below still runs through crust's own
> `createNativeWindow`, so "WebKit, not crust" is an inference: a bare-AppKit `WKWebView` probe is the
> follow-up that separates the floor from crust's configuration. Until it lands, the 318 ms is attributed,
> not proven.

**Verdict: the 634 ms is two native WebKit numbers, not a slow JS prelude and not blocking file I/O.**
The median launch is 635 ms; 318 ms is window + `WKWebView` creation and 192 ms is navigation to the
first page script. Together they are 510 ms, 80% of the total. A blank-document control still spends
390 ms in window creation, so the first number is WebKit object/service start-up, not crust logic and
not document load. No `src/**` file changed: the dominant segment lives in platform code this lane
does not own, and deferring it would mean an observable window that appears without its page.

## Method and safety

- Harness `scripts/perf/startup.ts`, format/aggregation `scripts/perf/startup-format.ts`. It follows
  the same bridge/platform path as the launch arm in `08-latency.md`, with a mark at every boundary.
  One process launch per sample; `--label` names the JSON under `docs/reviews/perf/startup/`.
- `processStart` is derived from `process.uptime()`, so marks include the static module graph parsed
  before the harness's first statement. Page anchors are `Date.now()` on the document and are
  converted to the same origin before the table is built.
- Every run went through `probe-run -c 'timeout 20 bun scripts/perf/startup.ts measure …'`. No OS
  screenshot, no synthesized input, no cursor movement; the window is created with `activate: false`
  and `testing.activation: "none"`. The private WebKit occlusion selector is applied before the page
  is evaluated (dev-only scaffold, never a shipped default). Cleanup covers `exit`, SIGINT, SIGTERM
  and SIGHUP; the harness fails if any probe PID survives it.
- Conditions were read at both ends with `scripts/perf/conditions.ts`: load and global `bun` count.
  **All 16 runs were contaminated** (one-minute load 3.12–6.97, 26–38 `bun` processes). No clean
  machine run exists; every number below is a loaded-machine measurement.
- Outliers are kept. The blank arm's 3269 ms sample ran at load 5.42 with 38 `bun` processes; it is
  in the distribution and in the control table's p95.

## Baseline: stacked table, page arm

Median of 10 page launches (`startup-before-*`, p50 635 ms). Rows sum exactly to the total.

| Segment | ms |
|---|---:|
| process start → first crust line | 15 |
| module graph + CLI parse | 1 |
| conditions snapshot (subprocesses) | 16 |
| native shim `cc` compile | 11 |
| `platform.start()` | 82 |
| bridge bind | 0 |
| window + `WKWebView` create | **318** |
| navigation → first page script | **192** |
| first page script → document complete | 0 |
| document complete → first rAF | 0 |
| **TOTAL** | **635** |

Page arm distribution: n=10, p50 635 ms, p95 887 ms, max 887 ms, min 598 ms. Sorted totals:
598, 601, 601, 613, 618, 635, 636, 657, 684, 887. The 887 ms outlier ran at load 3.80; the 684
ms one at 3.83 → 6.97. Load, not a code path, separates them.

### Mapping to the brief's six boundaries

| Brief boundary | Rows here | ms |
|---|---|---:|
| 1. process start → first runtime line | first row | 15 |
| 2. runtime init → native window created | rows 2–7 | 128 |
| 3. window created → webview configured | inside row 7 | not split |
| 4. webview → navigation committed | row 8 | 192 |
| 5. navigation → `complete` | row 9 | 0 |
| 6. `complete` → first rAF | row 10 | 0 |

Boundary 3 cannot be split without instrumenting `src/platform/darwin/window-create.ts`, which is
outside this lane's ownership. `createNativeWindow` builds the `NSWindow`, the `WKWebView`, installs
the content-world bridge and calls `loadRequest` in one synchronous pass; the blank control below is
the evidence for where its cost sits.

## Blank-document control

Same harness, `--blank`: load `about:blank` and stop at window creation. Rows 8–10 are zero by
definition. Median of 6 (`startup-blank-*`).

| Segment | ms |
|---|---:|
| process start → first crust line | 39 |
| module graph + CLI parse | 2 |
| conditions snapshot (subprocesses) | 51 |
| native shim `cc` compile | 32 |
| `platform.start()` | 96 |
| bridge bind | 1 |
| window + `WKWebView` create | **390** |
| navigation → first page script | 0 |
| first page script → document complete | 0 |
| document complete → first rAF | 0 |
| **TOTAL** | **611** |

Blank arm distribution: n=6, p50 611 ms, p95 3270 ms, max 3270 ms, min 463 ms. Sorted: 463, 485,
546, 611, 1086, 3269. At lower load the blank arm still takes 463–611 ms to return from
`platform.createWindow`, with no document, no bridge document response and no page script. The
navigation arm's 192 ms is therefore additive document/WebKit-side cost, not part of the native
window number.

## The suspicion checks

- **Bundle prelude.** First crust line is 15 ms at p50 (39 ms in the noisier blank median). The
  harness entry is 6,797 bytes plus 3,486 bytes of its format helper; `src/index.ts` is 1,112 bytes.
  A prelude this small cannot hide 600 ms. No build-time fix is indicated.
- **Log file.** `src/logging/sink.ts` opens nothing at startup: `createSink` stores paths, and
  `append` uses `mkdir`/`stat`/`appendFile` promises on the first record. `configureLogger` in
  `startApp` is a state assignment. No synchronous log open on the launch path.
- **Store / `store.json`.** `src/plugins/window-persist-store.ts` reads with async `readFile`, and
  only for frame restore. The measured harness restores no frame; the real app's frame read is
  asynchronous and sits inside `openWindows`, after `platform.start()`.
- **Config.** `src/config/load.ts` uses `stat` and a dynamic `import` for `crust.config.ts`. That path
  is not on the measured scaffold launch at all, so it cannot explain this number. It deserves its
  own runtime-instrumented arm if the real `crust dev` launch is ever measured separately.
- **`cc` compile.** 11 ms p50 for the probe's native shim; `platform.start()` (AppKit + crust shim)
  is 82 ms. Neither is dominant.

## Change and what it buys

No `src/**` change. The two large segments are `-[WKWebView initWithFrame:configuration:]`/`NSWindow`
creation and the first WebKit navigation. Moving any of the owned work — config, logger, deep link,
plugins — off the launch path would at most touch the 128 ms init subtotal and cannot shorten the
510 ms that dominates. Cutting the dominant segment would require starting the webview before the
window or faking an early frame; both change what the user sees, which the brief refuses.

What this lane adds is the measurement: `scripts/perf/startup.ts` makes the number reproducible and
writes a stacked table per launch, and the blank arm attributes the first large row to WebKit. The
next platform-level lane now has a target: 318 ms inside `createNativeWindow`, 192 ms in first
navigation.

## What a user will notice

Nothing changed in the app: the same window appears with the same page and the same first frame;
the 635 ms is now explained rather than hidden behind "startup".

## Gates

| Command | Result |
|---|---|
| `bun check` | PASS, exit 0 (1,274 files) |
| `bun run test` | PASS, exit 0 — 2990 pass / 0 fail |
| `bun run test:no-skips` | PASS, exit 0 — 2990 pass / 0 fail, no unapproved skips |
| `bun run check:lines` | PASS, exit 0 |
| `bun run e2e:single` | PASS, exit 0 — 27/27 assertions |

## Reproduce

```
cd ~/dev/worktrees/crust/perf-startup
probe-run -c 'timeout 20 bun scripts/perf/startup.ts measure --label startup-before-X'
probe-run -c 'timeout 20 bun scripts/perf/startup.ts measure --label startup-blank-X --blank'
bun scripts/perf/startup.ts summary --mode page
bun scripts/perf/startup.ts summary --mode blank
```
