# Hot paths: measured per-invoke and per-event cost

Lane B, branch `perf/hotpath`, worktree `~/dev/worktrees/crust/perf-hotpath`.
Bench artifact: `docs/reviews/perf/hotbench.ts`. Reproduce:

```sh
cd ~/dev/worktrees/crust/perf-hotpath && bun docs/reviews/perf/hotbench.ts
```

Every number below is **measured**: median of 5 reps, warmup 100–200, `n` in each row,
`performance.now()` around the loop. Allocation is `bun:jsc` `heapStats().mimalloc.malloc_requested`
delta per op (malloc-requested bytes, not JSC cell bytes — treat as an allocation signal, not an
exact object size). Three runs agreed on hot rows within ~6%; the largest allocation swings
(`redactFields`, `rotateChain`) came from allocator reuse, so time is the primary measure.

**Contaminated run.** Every run was made with loadavg `3.14–3.56` and 20–26 `bun` processes from
sibling lanes, above the 2.0 clean threshold. Treat absolute µs as an upper bound on a quiet
machine. The A/B row was interleaved A,B,A,A with a same-arm control; its delta (2.16 µs) is 30×
the control spread (0.068 µs), so that comparison stands despite load. Load and process counts are
printed on every bench row by the harness.

## Ranked measured operations

Sorted by time/op. `on path` = runs inside an invoke or event; `off path` = queued, awaited by a
test, or only on rotation. Aggregate rows (handler, invokeRequest, runner, logEvent) contain the
leaf rows below them; do not add them together.

| # | Operation | µs/op | malloc B/op | Path | file:line | Fix sketch (one line) |
|---|---|---:|---:|---|---|---|
| 1 | `rotateChain` (forced every write) | 49–61 | 9.9k–26.6k | off, rare | `src/logging/rotate.ts:28-50` | Check size once per batch and rotate on a timer, not inside each append. |
| 2 | `writeRecord` awaited | 49.6–53.8 | ~3.6k | off | `src/logging/logger.ts:153-172` | Already avoidable: callers that need a reply use `writeRecord`; the invoke path uses `logEvent`. |
| 3 | `sink.write` awaited (`mkdir`+`stat`+`appendFile`) | 45.7–48.9 | ~2.1k–4.0k | off | `src/logging/sink.ts:82-118` | Buffer lines and flush with one `stat`/`mkdir`/append per batch. |
| 4 | handler `/_crust/invoke` full route | 5.84–6.69 | ~6.6k–6.9k | on | `src/bridge/server/handler.ts:63-196` | Precompute the invoke route at `Bun.serve` setup; skip origin/CORS work for same-origin POSTs. |
| 5 | `invokeRequest` parse+run+response | 5.63–5.87 | ~6.7k | on | `src/bridge/server/invoke-request.ts:18-83` | Reuse the already-computed input size; cache the response header object. |
| 6 | `runner` with debug record written | 2.72–2.78 | ~1.8k–3.0k | on (debug) | `src/bridge/server/invoke.ts:52-151` | Gate record construction behind the level check before building `invokeRecord`. |
| 7 | `logEvent` sync part, debug level | 2.15–2.29 | ~1.5k–1.6k | on (debug) | `src/logging/logger.ts:175-185` | Memoise field-name classification and skip regex passes on shapes with no secret markers. |
| 8 | `buildRecord` (redact + ISO date) | 1.88–1.89 | ~1.3k | on (debug) | `src/logging/record.ts:23-35` | Cache `toISOString()` per timestamp tick; build fields lazily. |
| 9 | `redactFields` (8 fields) | 1.66–1.83 | ~1.4k–2.6k | on (debug) | `src/logging/redact.ts:171-180` | Cache `isSecretName` per key and fast-path strings without `?`, `Bearer` or `:`. |
| 10 | `client/invoke` full, stub fetch | 0.51–0.54 | ~496 | on (page) | `src/bridge/client/invoke.ts:119-161` | In `revive`, return the original object when no tag key is present instead of `defineProperty` per key. |
| 11 | `invokeRecord` builder | 0.215–0.221 | ~202 | on (debug) | `src/logging/records.ts:51-77` | Precompute the fixed fields (`source`, `event`) once per event type. |
| 12 | `serializeRecord` | 0.109–0.120 | ~228 | on (debug) | `src/logging/record.ts:37-39` | Serialise in the sink's queued task, not before enqueue. |
| 13 | `encodeResult` (small object) | 0.074–0.080 | ~3.7 | on | `src/bridge/server/bytes.ts:49-69` | Already fast: one `Object.keys` walk, returns the original object unchanged. |
| 14 | `JSON.stringify` invoke body | 0.065–0.074 | 133 | on (page) | `src/bridge/client/invoke.ts:132-141` | Cache the header/body envelope shape for repeated calls with the same plugin/command. |
| 15 | `JSON.parse` answer | 0.067–0.070 | ~5–7 | on (page) | `src/bridge/client/invoke.ts:142-160` | No fix worth a change at this cost. |
| 16 | `redactText` short msg | 0.067–0.068 | ~3.7 | on (debug) | `src/logging/redact.ts:111-118` | Skip the five regexes when the text has no `?`, `Bearer`, `Basic`, `Cookie` or `"key":` marker. |
| 17 | `JSON.stringify`+`byteLengthOf` size | 0.053–0.056 | ~68 | on | `src/bridge/server/body.ts:44-54` | Stop stringifying twice: pass `bytesOut` from the response envelope. |
| 18 | `new URL` + `corsHeaders` | 0.053–0.054 | ~85 | on | `src/bridge/server/handler.ts:64-67` | Split path/query once at setup for the fixed invoke route. |
| 19 | `sseFrame` per event | 0.050–0.052 | ~54 | on (event) | `src/bridge/server/events.ts:45-54` | Sanitise the event name at emit registration, not per frame. |
| 20 | `events.emit` (no subscriber) | 0.097–0.110 | ~138–139 | on (event) | `src/bridge/server/events.ts:90-102` | Skip frame construction when `subscribers.size === 0`. |
| 21 | `events.emit` + 1 enqueue | 0.105–0.123 | ~168–170 | on (event) | `src/bridge/server/events.ts:90-102` | Coalesce frames per tick into one `controller.enqueue`. |
| 22 | page `dispatch` (3 listeners) | 0.074–0.078 | ~53 | on (event) | `src/bridge/client/install.ts:73-100` | Avoid `Array.from(set)` per event; snapshot only when a listener mutates the set. |
| 23 | `PluginRegistry.invoke` (not on wire) | 0.114–0.118 | ~31–43 | unused | `src/plugins/registry.ts:68-90` | Wire path uses the flat `Map`; leave this as the in-process API. |
| 24 | `timer/pump` JS re-arm (one tick) | 0.104–0.112 | ~140 | on timer | `src/platform/darwin/pump.ts:34-48` | Native `shim_pump` is the real cost (read); idle-back-off the 16 ms interval. |
| 25 | `frameMemory.sample` (1 window) | 0.064–0.076 | ~16–18 | on timer | `src/plugins/window-frame-memory.ts:123-134` | Sample on resize/focus notifications instead of a 400 ms poll. |
| 26 | capability allow (compiled patterns) | 0.026–0.032 | ~4–12 | on | `src/bridge/server/capabilities.ts:95-108` | Already cheap; cache match results by `(label, action)` if a label holds many patterns. |
| 27 | `effectiveAction`+`candidateActions` | 0.014–0.015 | ~8–9 | on | `src/bridge/server/actions.ts:31-44` | No fix needed. |
| 28 | context spread (routing hint) | 0.010–0.011 | ~3.6 | on | `src/bridge/server/invoke.ts:89` | Prebuild a per-label context rather than spreading on each call. |
| 29 | handler `Map.get` | 0.008–0.009 | ~3.6 | on | `src/plugins/registry.ts:93-101` | No fix needed. |
| 30 | capability allow (open) | 0.003–0.004 | ~3.6 | on | `src/bridge/server/capabilities.ts:44-48` | No fix needed. |
| 31 | `logEvent` gate at default `info` | 0.012 | ~4.2 | on | `src/logging/logger.ts:175-185` | Already a two-comparison gate. |
| 32 | `logEvent`, no logger configured | 0.008–0.009 | ~3.7 | on | `src/logging/logger.ts:176-179` | Already a null check. |
| — | `await Promise.resolve()` control | 0.060–0.062 | ~16–26 | baseline | bench harness | Subtract from async rows for pure handler work. |

## Top five

**Raw cost, highest first:** forced `rotateChain` (49–61 µs, off path, rare), awaited
`writeRecord` (50–54 µs, off path), awaited `sink.write` (46–49 µs, off path), full handler route
(5.8–6.7 µs, on path), full `invokeRequest` (5.6–5.9 µs, on path).

**On the answering path, highest first:** handler route, `invokeRequest`, runner with debug record
(2.7 µs), `logEvent` sync redaction (2.2 µs), `buildRecord`/`redactFields` (1.9/1.7 µs).
At the default `info` level the logging rows collapse to the 0.012 µs gate, so the on-path top
two become the request/response plumbing, not logging.

**Single biggest avoidable one:** debug-level per-invoke redaction (`redactFields` + `buildRecord`
≈ 2.2 µs, ~1.5 KB/op, ~35% of the 6 µs handler route). The A/B row measured `0.556` µs filtered
vs `2.720` µs written with interleaved arms and a `0.558/0.489` µs control — a 2.16 µs difference
against a 0.068 µs control spread. Fix: memoise `isSecretName` and add a marker fast path in
`redactText`, or move record construction into the sink's already-async task. The file write itself
is already off the answering path (`logEvent` uses `void …sink.write()`), so making the append
`async` is not a further win; batching the `stat` per append is.

## Per-hop invoke path (page → bridge → handler → page)

- Page client: JSON body + POST + answer parse + `revive` = `0.51–0.54 µs` measured with a stub
  fetch (`src/bridge/client/invoke.ts:119-161`). Socket time is separate; prior
  `research/bridge.md` measured 45 µs reused / 119 µs fresh sockets over 200 calls.
- Bridge gate: `new URL`, origin, token, route = inside the `5.8–6.7 µs` measured handler row
  (`src/bridge/server/handler.ts:63-196`).
- Request: body read, `JSON.parse`, type check = inside `5.6–5.9 µs` (`invoke-request.ts:18-83`).
  No schema validation per invoke: `validateConfig` runs at load (`src/config/schema.ts:48`,
  `src/config/load.ts:79,97`); the request checks only `typeof plugin/command`
  (`invoke-request.ts:68`). **read**
- Dispatch: flat `Map` built once at `src/bridge/server.ts:36,69`; `handlers.get` 0.008 µs
  measured; capability check 0.003 µs open / 0.026–0.032 µs compiled; per-call context spread
  0.010 µs. `PluginRegistry.invoke` (0.114 µs) is not on the wire path. **read** for the wiring.
- Handler stub returns synchronously here; real plugin handlers were not measured (they belong to
  apps and run native calls).
- Answer: `encodeResult` 0.074–0.080 µs + `jsonResponse` inside the `invokeRequest` row; page
  `revive` and `dispatch` are inside the client/event rows.

## Event stream, batching, timers

- Transport is one long-lived SSE `ReadableStream` consumed by `EventSource` (token in query),
  not polling, long-poll or WebSocket (`src/bridge/server/events.ts:105-150`,
  `src/bridge/client/invoke.ts:179-197`). **read**
- No application-level batching: `emit` builds one frame and enqueues to each subscriber per call
  (`events.ts:90-102`), page `decode` parses JSON per frame and `dispatch` iterates a copied
  listener set (`install.ts:73-100`). Wire-level coalescing was measured earlier in
  `research/bridge.md` (50 frames in one tick arrived as one 1090-byte chunk), but that is Bun's
  socket write, not crust batching. **read** for the earlier number.
- Per-event measured: `sseFrame` 0.050–0.052 µs, `emit` no subscriber 0.097–0.110 µs,
  `emit`+enqueue 0.105–0.123 µs, page dispatch with 3 listeners 0.074–0.078 µs.
- Timers: Cocoa pump at `PUMP_INTERVAL_MS = 16` (`src/app-types.ts:117`, started at
  `src/app.ts:160`) — ~62.5 tick/s; JS re-arm 0.104–0.112 µs measured, native `shim_pump` call
  **read** (`src/platform/darwin/platform.ts:78-80`). Window closed + lifecycle watches at 250 ms
  (`src/app-watch.ts:20,83-105,131-183`) and deep-link drain at 250 ms (`app-loop.ts:136-140`)
  are **read**: they call native sources not callable headlessly. Frame-memory poll at 400 ms
  measured 0.064–0.076 µs for one window (`window-frame-memory.ts:123-134,159-163`); dev reload
  watcher + 80 ms debounce is dev-only (`events.ts:71-88`). Positioner and window-state are
  per-command handlers, not per-frame work (`src/plugins/positioner.ts:131-196`). **read**
- Console mirroring in `crust dev` (`src/logging/mirror.ts:34-38`) adds a synchronous
  `console.log`/`warn`/`error` per record on the answering path; not measured here (no terminal
  I/O in the bench). **read**
