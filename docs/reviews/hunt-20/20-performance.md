# Hunt 20 — performance and resource growth

Field: event-pump blockers, sync work on hot paths, unbounded arrays/maps, timers and listeners
that outlive their owner, per-request allocation, long-session degradation.
All claims below are `read` (source inspection only); nothing was built, launched or measured.
Only line numbers I opened are cited.

## Medium — Bridge `labels` map grows one permanent credential per document/window, never retired
- where: `src/bridge/server/handler.ts:78-86` (mint + `state.labels.set`), `src/bridge/server.ts:54-55` (map creation, process token seed); no `delete`/`clear` exists — `rg '\.labels\.(set|delete|clear)' src/bridge` returns only the one `set` at handler.ts:80.
- mechanism: On a real navigation presented with the process token (`presented === token && origin === null`), `serveDocument` mints `crypto.randomUUID()`, inserts it into `state.labels`, and 302-redirects. Nothing removes it. Every entry stays a valid bearer credential because `issued()` (handler.ts:153-154) and the `authority` lookup (handler.ts:169) are pure `labels.has`/`labels.get`.
- reachable by: (a) every configured window at startup navigates with the process token from `windowUrl` (`app-loop.ts:60-61`), seeding one entry each; (b) the main growth path — `window.create` builds its URL with `currentBridgeToken()` (`src/plugins/window-create.ts:70-79`), so every dynamically created window mints another entry. An app that opens and closes windows across a long session accumulates one Map entry per create, and each retired window's document token remains a usable invoke credential for its bound label after the window is gone. The map is also consulted on every request, so the stale entries live for the bridge's whole life.
- smallest fix: retire a label on window close (delete its token from `state.labels` in the window-close path), or cap/evict the map. Deleting on close also removes the lingering authority, which is the security-relevant half.

## Low — `Events.emit` drops a dead subscriber from `subscribers` but not from `cleanups`, retaining its stream controller
- where: `src/bridge/server/events.ts:82-91` (`emit`'s `catch` at 87-89), contrasted with `detached` at 106-119 which removes from both sets and is the only cleanup for a stream.
- mechanism: When `controller.enqueue` throws (the consumer's stream is closed), `emit` deletes the subscriber from `subscribers` but leaves its `detached` closure in `cleanups`. That closure still captures `controller` and `subscriber`, so the dead stream is retained until `stop()`. At most one orphan per disconnect.
- reachable by: an SSE connection whose transport dies without the server's `cancel()` running (abrupt client/process loss), followed by any `emit` — a `dev:reload` frame or an `app:` event. If `cancel` later fires it removes the closure too, so the leak needs a disconnect where `cancel` never arrives; that condition is plausible but not proven here (`read`, not `measured`).
- smallest fix: store the detach callback on the `Subscriber` and call it from the `catch`, instead of only `subscribers.delete(subscriber)`.

## Low — Named-store `scopes` map grows one `StoreScope` per distinct page-supplied name, with no eviction
- where: `src/plugins/store.ts:103-110` (`scopes` Map + `scopeFor`); file creation at `src/plugins/store-scope.ts:65-67` (`persist` -> `writeStore`), name validated but not length-capped at `store-scope.ts:28-33`.
- mechanism: `scopeFor(name)` caches a `StoreScope` per name for the plugin's lifetime. Names are page-controlled (`args.name`), validated only by charset, so every distinct name adds an in-memory scope; each `set` also writes a `store.<name>.json` file under the data root.
- reachable by: a page calls `store.set({ name: N, key, value })` with a large number of distinct valid `N` (e.g. derived from user/remote input). The `scopes` Map and the on-disk file count grow without bound for the life of the process. This is page-input-driven, so it needs a buggy or hostile page, not normal usage.
- smallest fix: cap the number of cached scopes (evict least-recently-used) and/or bound accepted name length/count per session.

## Checked and clean
- `pageSinks` idempotency (`app-watch.ts:29-47`, `runtime-app-namespace.ts:21,34`): the only production sinks are `ctx.emit`, and `server.ts:44-45` creates one shared `ctx` per bridge, so `Set` identity keeps this at one entry; the returned disarm is unused but there is no per-request growth. `clearPageEvents()` is used only by tests (a stopped-then-restarted bridge in one process would retain the old sink, but one bridge per process is the documented contract).
- Power observers (`darwin/power-events.ts:73-77`, `darwin/shim/116_power_events.c:135-143`): `listeners.set(kind, ...)` replaces per kind and `crust_power_watch` is guarded by a `pw_watching` bitmask, so re-subscribing does not stack native `NSNotificationCenter` observers.
- Bounded rings/record caps: `shell.ts:25,75-80` (`MAX_RECORDS` 256 with prune), `shell-stream.ts:8-9,17-32` (500 lines, 8192-char lines), `logging.ts:20,167-168` (`RING_SIZE` 200). No growth there.
- Sidecar registry (`sidecar-control.ts:79-101`, `sidecar-commands.ts:104-114`): `running.delete(id)` on child exit and the kill timer is cleared in `finish`, so no orphan timer or entry.
- Event-stream normal teardown (`events.ts:106-123,135-140`): `cancel()` and `stop()` remove subscribers and cleanups; the concern above is limited to the enqueue-throw branch.
- Single-instance `pending` map (`runtime-single.ts:54-65`): keyed by lock path, seeded once per launch, drained and cleared on exit.
- Hot-path sync work / JSON size: `invoke.ts:21-22,95-122,161-169` caps bodies at 2 MiB before `JSON.parse` and streams with a byte counter; `assets.ts:56-57` uses async `Bun.file(...).exists()`; `events.ts:24-30` `readFileSync` runs only in the debounced reload watcher, not per request. No synchronous disk read or `spawnSync` on the invoke/event path was found.
- Timers with lifecycle owners: `app.ts:40-41,162-188` starts window/lifecycle watches only when listeners exist and clears both in `quit()`; both handles are `unref`'d (`app-watch.ts:100,160`), so they cannot hold the process open.
