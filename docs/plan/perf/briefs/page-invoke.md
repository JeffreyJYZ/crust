# Brief: the page-side cost of an invoke

Lane A measured, on the animating probe page, **212 ms frame-time p95 with 8 long frames** under
sustained invokes, while lane B measured the backend invoke route at **5.8–6.7 µs**. Those two numbers
cannot both describe the same 212 ms. The gap is on the page: receiving a reply, reviving it, and
whatever the page does when it lands.

## Own

- `src/bridge/client/**` and its tests.
- A new worktree: `~/dev/worktrees/crust/perf-pageinvoke`, branch `perf/pageinvoke`.

Nothing else. Do not touch `src/perf/**` (lane F), `src/platform/**` (lane E), `src/bridge/server/**` or
`scripts/perf/**`.

## Measure first

Committed reading: `docs/reviews/perf/01-baseline.md`, `02-hotpaths.md`, `04-parity.md` are in your tree.

Decompose the page-side receive path with a page-owned benchmark (a page in a real window, timings from
that page's own clock, not from the backend):

1. **Reply receipt, one invoke.** Time from "the request promise resolves as a macrotask begins" to
   "handler code runs", per call, p50/p95 over a few thousand calls.
2. **Payload revive.** Small (a boolean), medium (a 4 KB object), large (1 MB binary): JSON parse cost,
   plus the base64/`atob` path if binary results take it (`src/bridge/client/invoke.ts:52-85`).
3. **What the reply wakes.** Does a reply schedule a microtask flood, re-read a subscription, touch the
   DOM, or notify every pending listener? Instrument the path and name the biggest contributor.
4. **Frame impact.** The same animating page with zero invokes, 30/s, and 200/s: frame-time p50/p95,
   long frames, and frames drawn. That is the number the user feels.

## Then fix what the numbers name

Likely candidates, in order of expected value — pick by measurement:

- Per-reply allocation and JSON work on the page thread; reuse or batch where a burst of replies arrives.
- A reply that wakes every listener instead of the one that asked.
- The content-world relay (`WKContentWorld` → DOM `CustomEvent`) if it is on this path.
- Large binary payloads revived in the page: the transferable fix is fetch-by-id from
  `04-parity.md`, and lane B measured 1 MB at 2.4 ms JSON / 1.8 ms binary, so judge by the p95 tail.

## Method and safety

- `testing.activation: "none"` is what keeps focus theft out, but it also occludes the window and
  suspends rendering: **disable window occlusion detection in the probe's own scaffolding** (dev-only,
  never a shipped default) and fail the run when the page drew zero frames. Record both facts per run.
- Record `sysctl -n vm.loadavg` and the `bun` process count before and after each run, label runs over 2.0
  `contaminated`, interleave arms, keep a same-flag-vs-itself control row, and treat a delta under that
  spread as noise.
- Probes ≤ 15 s, kill by recorded PID in a trap covering success, error, timeout and SIGINT, and fail the
  run if the process count after exceeds baseline.
- `rg` not `grep`, `fd` not `find`, never scan from `/` or `~`. Files ≤ 200 lines.
- Gate: `bun check`, `bun run test`, `bun run test:no-skips`, `bun run check:lines`, `bun run e2e:single`.

## Report

`docs/reviews/perf/07-page-invoke.md`: the decomposition table, the before/after frame numbers for the
fix, the contaminated labels, and one line saying how much of the 212 ms was the page versus how much was
frame starvation from the pump (lane E measured each pump tick blocking 6.8 ms of a 16 ms budget).
