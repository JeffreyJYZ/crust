# Brief: profiler overlay (page half)

Read `docs/plan/perf/PROFILER.md`. You own the widget a developer actually looks at; the collector is
another lane's, so consume `window.crust.perf.sample()` and never reach into runtime internals.

## Own

- `src/perf/overlay/**` (new): `overlay.ts`, `panel.ts`, `sparkline.ts`, `sampler.ts`.
- `examples/perf-overlay/**` (new): a probe app that animates a fixed workload so the overlay has
  something honest to display.
- Tests beside each file.

Do **not** touch `src/perf/collector.ts`, `src/plugins/perf.ts`, `src/bridge/**` or `scripts/perf/**`.

## What it must do

1. `rAF` sampler in the page: fps, frame-time p50/p95/worst, long tasks via
   `PerformanceObserver({ type: "longtask" })`. Where `longtask` is unavailable report `n/a`, never `0`.
2. A single fixed-position panel, `position: fixed` on its own compositor layer, draggable, remembering
   its corner through `crust:store` (`src/plugins/store.ts`, one 0600 `store.json` under the app's data
   dir) — never a new file of your own. It must never trigger a page reflow of the app's content. Prove
   that with a test: sample `document.body.scrollHeight` and `getBoundingClientRect` of a sentinel element
   before and after the panel is shown and assert they are unchanged.
3. Per-plugin invoke table and event throughput, read from one `sample()` call per second — not one call
   per row.
4. A 10 s frame-time sparkline on a single `<canvas>`, red band when p95 > 32 ms.
5. Toggled by `window.crust.perf.overlay(true|false)` and, under `crust dev` only, one keyboard chord.
   Hot key conflicts must degrade to the API, never throw.

## The test that decides this lane

The overlay must report the same frame rate the page actually rendered. Drive the probe app's known
workload, read both the overlay's own number and an independent counter in the probe page, and assert
they agree within 5%. Print both numbers.

## Production absence

The overlay module must not be reachable from a production build. Prove it by building the example with
the production path and grepping the output for a marker string constant defined in `overlay.ts` —
absence is the assertion, a config read is not.

## Constraints

- Files ≤ 200 lines. No frameworks, no bundler-only syntax the runtime does not already support.
- Gate: `bun check`, `bun run test`, `bun run test:no-skips`, `bun run check:lines`, `bun run e2e:preview`.
- No focus theft, no OS screenshot: capture through crust's `window.capture` with
  `testing.activation: "none"`, 15 s cap, process count before/after with a PID trap.
- `rg` not `grep`, `fd` not `find`, never scan from `/` or `~`.

## Report

The two frame-rate numbers, the reflow assertion output, the production-absence grep, the new files, and
one screenshot-equivalent proof: the overlay's rendered text as captured by `window.capture`.
