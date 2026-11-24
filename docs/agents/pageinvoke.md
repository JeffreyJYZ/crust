# pageinvoke lane — measured facts and traps

- "212 ms frame p95 / 8 long frames" is absent from committed perf docs; `01-baseline.md` records 25/26 ms p95 and 0 long frames. Occluded-window artefact. Do not re-derive from it.
- The owned drop is 13.85 fps (`01-baseline.md:106-108`), reproducible only with lane A's sequential `pace(16)` + per-reply manual paint driver (`app.js:36-48`), not with invoke or SSE traffic.
- Split at 3 rounds, load 3.15–4.38 (all contaminated): invoke 30/s 62.86 fps, invoke 200/s 62.86, events 30 Hz 55.71, events 120 Hz 61.43, both 65.71, paced driver 44.29. Self-control spread 17.14 fps.
- Page-side primitives from page clock: 1 MB JSON parse 40 µs p50 / 100 µs p95, stringify 60–80 µs, 10-listener CustomEvent <1 µs. Binary invoke round trip 87–94 ms p95 at load 3.9; small/medium 4 ms.
- WKWebView clamps `performance.now()` to whole ms; batch ~50 ops and divide for µs/op.
- An external `<script>` in `<head>` cannot touch `document.body`; defer DOM setup to `DOMContentLoaded` or `window.__bench` is never defined.
- `testing.query`/`waitFor` failed on this page while direct `testing.evaluate` worked; poll a page-owned ready flag instead.
- `perfCollector.recordEmit` is not wired to plugin `ctx.emit` on main; event emitted/delivered in `perf.sample()` stay 0. Use page counters as delivery proof.
- Filter arm samples with p95 > 60 ms as external suspension; one `both-A` sample had 317 ms p95 while every other arm stayed at 25 ms.
- `time probe-run ... | tail` held the shell 15 min after the probe finished; plain `probe-run -c ... | tail` exits normally.
- Gate failures `scripts/butter-sweep.test.ts:121` and `native-setters` tooltip reproduce in isolation under load >2; unrelated to report-only lanes.
