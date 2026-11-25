# Lane M — launch to interactive, decomposed

**Verdict: an AppKit-only process takes 568 ms to first `requestAnimationFrame`; crust's additions
are at or below the 21 ms control spread.** The crust launch is 635 ms p50 (608 ms after removing
this harness's own 27 ms of snapshot/`cc` work). The bare floor is 568 ms p50 (536 ms after the same
subtraction), so crust adds about 72 ms end to end, and no individual piece — activation policy,
configuration, content-world scripts, scheme handler, process pool, bridge bind — is separable from
noise. No `src/**` file changed: there is no deferrable crust cost large enough to justify the risk,
and the bridge is on the document path, not just the invoke path.

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

## Harness overhead and the corrected app-launch figure

Two rows in the table belong to the measuring tool, not to an app: `conditions snapshot
(subprocesses)` 16 ms and `native shim cc compile` 11 ms (page-arm medians). The blank arm's
contaminated median shows 51 ms and 32 ms for the same rows — those larger figures belong to the
blank arm and must not be subtracted from the page arm's total. Subtracting each run's own two rows
from the page arm gives **p50 608 ms, p95 860 ms, min 573 ms, max 860 ms (n=10)**. That is the honest
launch-to-interactive number for the measured path.

The probe's `cc` row is `scripts/perf/perf-native.c`, compiled once by this harness. A built app does
not pay that file, but it **does** compile its own embedded shim at launch: `src/platform/darwin/index.ts:25-36`
calls `cc()` on the content-hashed temp copy. Measured separately on this machine (70,966 shim bytes):
17.2 ms on a cold TinyCC cache, ~1.3 ms warm. It sits inside `platform.start()`'s 82 ms row and is
therefore app cost, not harness cost.

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

## Bare AppKit floor and crust's deltas

The AppKit-only probe is measured in full in `10-startup-bare.md`. Its floor is **568 ms p50**
(536 ms after its own harness rows), with 112 ms in `NSApplication`/window/webview, 243 ms in
`loadHTMLString`/WebKit service start and 172 ms until first rAF. Across 12 cumulative arms the
same-flag control spreads 21 ms; every crust piece — activation policy, configuration, 7,230 bytes
of injected scripts, scheme handler, process pool, bridge bind — is at or inside that spread. The
bridge is on the document path: `bare-no-bridge` never painted in 4 s. Inline instead of a loopback
document saves 28 ms, inside noise. No `src/**` change followed.

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

No `src/**` change. The bare floor is 568 ms; crust's pieces are at or below the 21 ms control
spread, and the bridge cannot be deferred past document serving. Deferring config, logger, deep link
or plugins would touch only the 128 ms init subtotal, which the floor already covers. Cutting the
floor itself would require starting WebKit before the window or faking an early frame; both change
what the user sees.

What this lane adds is measurement: `scripts/perf/startup.ts` decomposes the crust launch, and
`scripts/perf/startup-bare.ts` measures the AppKit-only floor plus crust's pieces one at a time. The
objective statement is now: floor 568 ms, crust launch 635 ms (608 ms without harness overhead),
crust-attributable addition about 72 ms end to end with no single deferrable item above the noise
floor.

## What a user will notice

Nothing changed in the app: same window, same page, same first frame. The 635 ms is now split into
an AppKit/WebKit floor that cannot be removed from a desktop app and a small crust addition.

## Gates

| Command | Result |
|---|---|
| `bun check` | PASS, exit 0 (1,277 files) |
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
probe-run -c 'timeout 20 bun scripts/perf/startup-bare.ts measure --arm bare-inline --label bare-inline-X'
probe-run -c 'timeout 20 bun scripts/perf/startup-bare.ts measure --arm bare-deferred-load --label bare-deferred-load-X'
probe-run -c 'timeout 20 bun scripts/perf/startup-bare.ts measure --arm bare-http-control --label bare-http-control-X'
```
