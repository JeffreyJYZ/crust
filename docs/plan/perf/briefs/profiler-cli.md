# Brief: profiler CLI (`crust perf record` / `crust perf diff`)

Read `docs/plan/perf/PROFILER.md`. This lane makes a performance claim checkable in CI, which is the
whole reason the recorder exists: a fix without a before/after file from the same command is not a fix.

## Own

- `src/cli/perf/**` (new): `record.ts`, `diff.ts`, `format.ts`, `index.ts`, tests.
- `src/cli/index.ts` — the subcommand registration only (129 lines, so there is room); the smallest hunk
  that routes `perf`.

Do **not** touch `scripts/perf/**` (the harness lane owns it), `src/perf/overlay/**`, or
`src/perf/collector.ts`.

## Commands

```sh
crust perf record --app <path-to-app-or-dir> --seconds 10 --out perf.json [--format json|text]
crust perf diff before.json after.json [--tolerance 5]
```

- `record` launches the app with the perf sink on, collects one `PerfSample` per second, writes JSON, and
  prints the headline line `fps=<n> p50=<n>ms p95=<n>ms long=<n> heap=<n>MB`. Exit 0; exit 2 if the app
  never produced a sample.
- **`record` must disable window occlusion detection in its own launch path** (private selector, recorder
  only, recorded in the sample metadata). Without it an unfocused app is occluded, WebKit renders nothing,
  and every run records 0 fps — measured 0 → ~56 fps on the same page (`03-renderer.md`). A zero-frame run
  is exit 2 with the reason, never a JSON sample.
- `diff` prints a per-field table of `before → after` with the percentage delta, and exits 1 when any
  metric worse than `--tolerance` percent regressed, 0 otherwise. Frame time and p95 are "lower is
  better"; fps, event delivery and invoke throughput are "higher is better" — encode that per field
  rather than one blanket rule.

## The tests

- **Round-trip**: record a short run, feed the file to itself, assert every delta is 0 and exit 0.
- **Regression detected**: hand-edit a copy's `p95` upward past the tolerance, assert exit 1 and that the
  message names `frame.p95` with both numbers.
- **Honest failure**: point `record` at a path that is not an app and assert exit 2 with a message, not a
  zero-filled file — an empty sample that reads as "fast" is the defect this lane exists to prevent.

## Constraints

- Files ≤ 200 lines. `record` must not leave the app running: kill it in a `finally`, and fail the run if
  the process count after exceeds before.
- No focus theft, no OS screenshot on any path a test drives.
- Gate: `bun check`, `bun run test`, `bun run test:no-skips`, `bun run check:lines`.
- `rg` not `grep`, `fd` not `find`, never scan from `/` or `~`.

## Report

`crust perf record` and `crust perf diff` output verbatim on a real run, the three test outputs, the
process before/after counts, and the exact subcommand hunk in `src/cli/main.ts`.
