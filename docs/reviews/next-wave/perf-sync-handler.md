# Synchronous handler stall — Lane B1

Measured 2026-11-18, macOS 27 arm64 (M4 Air), Bun 1.4.4. No bridge code changed. The benchmark is
`docs/reviews/next-wave/probes/perf-sync-handler.ts`; run it with one command:

```
bun run docs/reviews/next-wave/probes/perf-sync-handler.ts
```

It starts a real bridge (`startBridge`, Bun.serve with token + origin gates intact), registers
`perf.block` (a synchronous 200 ms busy-wait) and `perf.yield` (the async control), fires three
concurrent invokes, and records wall time, per-invoke latency, and pump ticks. The pump is a
self-rearming 16 ms `setTimeout` chain — the exact mechanism the platform uses to drive native
repaint (`src/platform/darwin/platform.ts:64-78`, `PUMP_INTERVAL_MS` = 16 at `src/app-types.ts:98`).
A tick cannot fire while the loop is blocked, so a gap in ticks is a window with no repaint.

## What the benchmark printed (verbatim, one run)

```
block (3 x 200ms sync): wall 602.2ms, invokes 401.8/601.8/601.9ms
  pump ticks in window 4 (healthy ~38), max gap 201.4ms
control (3 x 200ms async): wall 201.4ms, invokes 201.4/201.4/201.4ms
  pump ticks in window 12 (healthy ~13), max gap 17.0ms
SUMMARY: 3 synchronous 200ms handlers serialise to 602.2ms wall; pump stalled 201.4ms (no repaint); invokes queued 401.8/601.8/601.9ms. Async control overlaps to 201.4ms.
```

Three consecutive runs gave wall `602.0–602.4 ms`, pump ticks in window `3–4` vs `~38` expected,
and a max pump gap of `201.4–400.3 ms` (the gap widens when no tick squeezes between handlers).
The control was stable at wall `201.4–201.7 ms`, all three invokes `~201.5 ms`, `12` ticks vs `~13`,
max gap `17.0 ms`.

## What a user actually feels

- **The window does not repaint during the block.** Only `3–4` pump ticks land in a `~600 ms`
  window where `~38` should — roughly `6 fps` instead of `60`, with a `200–400 ms` freeze (the max
  gap). The pump is the repaint driver, so no tick means no native draw. This is measured on the
  real pump-interval timer; I did not capture a WKWebView screenshot, so the frame count is the
  mechanism-level proxy, not a pixel diff.
- **A second invoke queues; it does not run concurrently.** All three invokes complete at
  `~602 ms` (the first sometimes `~402 ms`), and the wall is `602 ms`, not `200 ms`. Because the
  caller and the bridge share one event loop, even the first response is unreadable until the last
  handler returns. The async control overlaps all three into `~201 ms`, proving the serialization
  is caused by the blocking handler, not by the bridge.
- **Number a user would notice:** the `~602 ms` wait for a second click, and the `200–400 ms`
  repaint freeze. The `0.036 ms` bridge hop (`research/bridge.md`) is irrelevant next to either.

## Candidate fixes and their cost to plugin authors

Both change the *execution model* plugins run under, which is a plugin-contract decision the user
owns. This lane recommends only; it does not implement either.

**Status: closed — not worth a contract change.** The measured freeze only happens if a handler blocks
the pump, and no plugin crust ships does: the sync calls in-tree are `readFileSync` in `i18n.load`,
which is a one-shot config read, not a request path. So no user hits this today. The number is a
documented limit for a third-party plugin that writes a slow handler, and the two fixes below stay
unimplemented because each moves the plugin contract for a case that does not occur.

### 1. Per-plugin worker

Dispatch each plugin's handlers to a worker thread dedicated to that plugin. One plugin's blocking
work no longer stalls the main event loop or other plugins; the caller sees the async control's
`~201 ms` wall.

Cost imposed on plugin authors:
- **Serializable boundary.** Arguments and results must survive structured clone — no functions,
  no native/FFI handles, no captured objects. Today a handler can close over arbitrary JS state.
- **Context becomes proxied.** `ctx.emit` and `ctx.window` must be messaged back to the main thread;
  a plugin that emits events takes an async hop.
- **No direct platform access from a handler.** `shim`/FFI handles are not transferable; plugins
  calling native APIs directly need a main-thread proxy command.
- **State isolation.** Module-level state shared across a plugin's commands must move explicitly
  into the worker; a fresh worker per plugin also adds spin-up time and memory.

### 2. Second process

Run plugins in a separate OS process and talk to the bridge over IPC. Strongest isolation — a hung
or crashed plugin cannot take down the app, and CPU work is truly parallel.

Cost imposed on plugin authors:
- **Full IPC discipline.** Every argument and result is serialized over a process boundary; much
  stricter than the worker case, with a per-call latency far above the `0.036 ms` in-process hop.
- **Distribution changes.** A plugin becomes a spawned process with an entry point and a wire
  protocol, not a JS module loaded in-process. Third-party plugins need a runtime/sidecar contract.
- **Lifecycle ownership.** Spawn, health-check, restart-on-crash; a plugin cannot rely on in-process
  singletons and must survive being killed and restarted.
- **No in-process native handles**, harder debugging and versioning, and a larger packaging surface.

## Recommendation

Adopt per-plugin workers first: bounded cost, plugins stay JS modules, and it removes both the
`~600 ms` invoke serialization and the `200–400 ms` repaint freeze; reserve a second process for
untrusted or crash-prone plugins where isolation justifies the distribution cost. Contract change
left to the user.
