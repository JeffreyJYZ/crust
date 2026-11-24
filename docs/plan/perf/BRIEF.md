# crust performance: measure, fix, then make it visible

Objective from the owner: crust apps are slow and low-fps; Tauri apps and Rune apps feel smooth. Make
crust much faster, and ship a profiler like opencode's debug overlay. User-facing behaviour stays
backward compatible, or ships an automatic migration.

## Non-negotiables

- **Evidence, not opinion.** Every claim is a number from a run on this machine: frame rate, frame
  time p50/p95, invoke latency, event latency, CPU%, resident memory. A lane that cannot measure a
  claim says so and proposes the measurement instead of asserting.
- **No focus theft, no leaked processes.** A capture uses crust's own `window.capture` with
  `testing.activation: "none"`, never an OS screenshot. Every probe counts `bun`/app processes before
  and after, kills by recorded PID in a trap covering success, error, timeout and SIGINT, and fails
  the run if the after count exceeds the baseline. A probe run is 15 s or shorter.
- `rg`, never `grep`; `fd`, never `find`; never scan from `/` or `~`. Every file at or under 200 lines.
- Gate for a change: `bun check`, `bun run test`, `bun run test:no-skips`, `bun run check:lines`, plus
  the e2e that owns the touched path.

## What "smooth" has to mean here

A crust app is a Bun backend plus the system WebView. The webview's compositor is the same one Tauri
uses, so a 30 fps crust app is not a renderer limit — it is work crust puts on the main thread, on the
webview's script thread, or on the wire between them. The baseline has to separate those three:
render the same page with no crust bridge traffic, then with the bridge idle, then with the bridge
under load, and report fps and long-task counts for each.

## The profiler

An overlay a developer can open in a running app, showing at least: fps and frame-time p95, long tasks
(>50 ms) in the last second, invoke count/latency p50/p95 by plugin, event throughput, main-thread
event-loop delay, and heap. It must be opt-in, cost nothing measurable when off, and never ship in a
production build unless asked. Also expose the same numbers to a CLI so a lane can record them
headlessly.

## Order of work

1. Baseline harness + numbers (must exist before any fix is claimed).
2. Ranked hot paths from measurement, not from reading.
3. Fix the top ones, re-measure the same harness, report before/after.
4. Profiler overlay + CLI recorder, with its own test that it reports real numbers.
5. Docs: a performance page, and the honest comparison with Tauri/Rune.
