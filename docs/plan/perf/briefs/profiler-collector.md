# Brief: profiler collector (runtime half)

Read `docs/plan/perf/PROFILER.md` first — the `PerfSample` shape, the sink list and the "off costs
nothing" rule are the contract, not suggestions.

## Own

- `src/perf/**` (new): `collector.ts`, `histogram.ts`, `sample.ts`, `index.ts`.
- `src/plugins/perf.ts` (new): the `perf` plugin, its commands and its capability name.
- `src/bridge/server/invoke.ts` (152 lines) — the dispatch seam: one increment on entry and one latency
  sample on answer, so every invoke is counted exactly once.
- `src/bridge/server/handler.ts` is **197 lines, three short of the cap** — do not grow it; if instrumenting
  it is unavoidable, split it first in its own commit and say so in your report.
- Tests beside each file.

Do **not** touch `src/runtime-plugins.ts` (it is at the 200-line cap — if it must change, split first and
say so in your report), `scripts/perf/**` (another lane owns the harness), `src/perf/overlay/**` and
`src/cli/perf/**` (two more lanes), or any `site/` page.

## What it must do

1. A collector with three independently-enabled sinks (`overlay`, `file`, `stdout`), all off by default.
2. Counters: per-plugin invoke count/p50/p95/errors, event emitted/delivered/dropped/p95, log records
   and ms, all allocated lazily on first use of a name.
3. `perf_hooks.monitorEventLoopDelay` with a bounded histogram, and `process.memoryUsage().heapUsed`
   read on the sample tick only — never per invoke.
4. `window.crust.perf` commands: `sample()` returning a `PerfSample`, `overlay(bool)`, `sinks({...})`,
   `reset()`. Each refuses `not-implemented` with a `requires` string when the plugin is absent.
5. A `perf` capability that defaults to refused, like every other namespace.

## The two tests that decide this lane

- **Off is free**: spy on the clock source, run 10k invokes with every sink off, assert zero clock reads
  beyond the ones the bridge already made and no new allocation growth beyond a small bound. Print both
  numbers in the report.
- **Accounting is exact**: N invokes across two plugins → per-plugin counts sum to N; N emits and M
  deliveries → `emitted - delivered` equals what the test deliberately left undelivered.

## Constraints

- Files ≤ 200 lines (split by responsibility, never trim a comment that records a measured reason).
- Gate: `bun check`, `bun run test`, `bun run test:no-skips`, `bun run check:lines`, and the e2e that owns
  the bridge (`bun run e2e:single`).
- No focus theft, no OS screenshot, no leaked processes in any probe you write.
- `rg` not `grep`, `fd` not `find`, never scan from `/` or `~`.

## Report

The two test outputs verbatim, the per-invoke overhead with sinks off (µs, measured), the new files, and
anything you had to change outside `src/perf/**`.
