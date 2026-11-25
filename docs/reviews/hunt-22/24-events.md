# Hunt 22 — event system: emit, SSE, listeners, ordering, drops

Read-only hunt. Scope: `src/bridge/server/events.ts`, the two client transports (`src/bridge/client/**`,
`src/platform/darwin/content-world-source.ts`), listener registries (`app-watch.ts`, `app-deep-link.ts`,
`app-window-watch.ts`, `app-quit.ts`, `plugins/navigation-listeners.ts`, `plugins/power-subscribe.ts`,
`plugins/network-status.ts`) and the burst sources (`plugins/pty-stream.ts`, `plugins/shell-stream.ts`).
Discovery used `rg`/`fd`. Claims marked **measured** came from short Bun scripts under the approved
temp dir that imported the real modules. The two event suites (`server-events.test.ts`,
`events-reload.test.ts`) were run read-only: 12 pass, 0 fail. No source was edited, no full gate or
build run, no GUI touched.

**Count: 4 findings** (0 high, 2 medium, 2 low).

---

## F1 (medium) — plugin listener bookkeeping keys on `ctx.emit`, which is one function for the whole process

- `src/plugins/navigation-listeners.ts:19-23,35-45,64-75` — `Installed.emits` is a `Set` of
  `PluginContext["emit"]` functions. `start` adds the caller's `emit`; `stop` deletes it and calls
  `web.stop(label)` when the set goes empty.
- `src/bridge/server.ts:45-46` creates exactly one `ctx = { emit }`, and
  `src/bridge/server/invoke.ts:91` hands every handler that same function (`{ ...ctx, window:
  routing }` copies the reference). Production therefore gives every page, every window and every
  invoke the **same** emit identity. `src/app-deep-link.ts:12-21` uses the same identity as a page-set
  key, with the same limitation.
- Mechanism: two pages that both call `navigation.start` on the same window produce one set entry,
  not two. The second `start` is a no-op on the set (the comment at `navigation-listeners.ts:5-8`
  says a second caller only registers another emit), and one page's `stop` empties the set and
  uninstalls the native delegate while the other page is still listening.
- **Measured** against the real plugin with a fake adapter and one shared emit (the production
  shape): `A start ok`, `B start ok`, `A stop {ok:true, stopped:true}`; native calls were
  `start,stop`; a later `did-finish` fired no event. The existing test
  (`src/plugins/navigation-events.test.ts:78-97`) passes because `collector()` gives the two pages
  distinct emit functions, which never happens in a running bridge.
- Reachable by: any two pages on one window (or a page that re-registers after reload and then
  stops) calling `navigation.start` / `navigation.stop`. The page that did not stop silently loses
  `navigation:did-start/did-commit/did-finish/did-fail`; `state()` and loads keep working, so the
  failure is invisible until a navigation is missed. This is a residual of the platform-level fix
  reported in hunt-21/11, at the plugin layer added to hold per-page emits.
- Smallest fix: key listener registration on something the bridge already varies per call —
  `ctx.window` plus a per-invoke token — or have `createRunner` hand each handler its own emit
  closure. `ctx.window` alone is not enough for two pages in the same window.

---

## F2 (medium) — page-side `app:` events are never published on the all-windows-closed or `app.quit()` paths

- `src/app-watch.ts:113-121` (`emitOnQuit`) calls `emit(listeners, event)` only;
  `src/app-quit.ts:17-26` (`finishQuit`) chains the same function for `before-quit` and `will-quit`;
  `src/app-window-watch.ts:23-26` uses it for `window-all-closed`. Page delivery
  (`publishPageEvent`, `src/app-watch.ts:62-71`) is called from exactly one place:
  `watchLifecycle` at `src/app-watch.ts:169`, which only handles events from the platform's native
  lifecycle queue (⌘Q on macOS).
- Mechanism: closing the last window — the most common quit — and a backend `app.quit()` emit
  `window-all-closed`, `before-quit` and `will-quit` to `app.on` listeners only. No `app:*` SSE frame
  is produced, so a page waiting on `crust.once("app:before-quit")` or listening for
  `app:window-all-closed` never fires on that path, even though the same event reaches the page on
  the ⌘Q path. `site/app/docs/reference/parity/page.mdx:99` promises `before-quit` and `will-quit`
  as `app:*` page events without qualifying the path.
- **Measured**: subscribed a real page sink, called `emitOnQuit` for the three quit events, and read
  the sink: `page events from quit path: []`. Backend listeners ran.
- Smallest fix: call `publishPageEvent(event)` inside `emitOnQuit` and keep the native-lifecycle
  call site from double-publishing (let `watchLifecycle` call `emitOnQuit` rather than raw `emit`).

---

## F3 (low) — `watchLifecycle` page/backend ordering claim is false when a listener awaits

- `src/app-watch.ts:166-179` publishes the page frame synchronously for every drained event, then
  starts `void emit(listeners, event)` for that event. `emit` (`src/app-loop.ts:110-118`) invokes the
  first listener synchronously and awaits it; the remaining listeners, and every later event's
  backend fan-out, run in later microtasks. The comment at `src/app-watch.ts:58-59` claims the page
  and backend "can never see different events, or different order".
- **Measured**: two drained events (`activate`, `reopen`), with `activate` having one async and one
  sync listener. Page frames were `app:activate,app:reopen`; backend listener order was
  `reopen:sync,activate:async,activate:sync`. The page saw `reopen` before the backend had even
  delivered `activate` to either of its two listeners.
- Reachable by: any native lifecycle burst (macOS can queue `activate` then `reopen`) with an async
  `app.on` listener, typically the save-on-quit shape that awaits a file write.
- Smallest fix: `await emit(listeners, event)` for each event inside the loop before publishing the
  next page frame, or correct the comment if interleaving is intentional.

---

## F4 (low) — a throwing subscriber is dropped from `subscribers` but its stream cleanup is retained

- `src/bridge/server/events.ts:90-102` catches a throw from `subscriber.enqueue(frame)` and only
  calls `this.subscribers.delete(subscriber)`. The stream's teardown closure (`detached`,
  `events.ts:121-134`) is the thing that removes the same subscriber **and** its entry in
  `this.cleanups`; it is not called on this path.
- Mechanism: when `controller.enqueue` throws (the controller is closed or errored without the
  consumer's `cancel()` having run), the dead stream keeps its cleanup closure, controller and
  bound subscriber alive in `cleanups` until the bridge stops. Each such stream is one retained
  closure for the process lifetime. `retainedCleanups` (`events.ts:163-165`) is the test-visible
  counter that would show it.
- **Measured**: forced one registered subscriber's `enqueue` to throw. `subscribers` went `1 → 0`
  but `retainedCleanups` stayed `1`; it returned to `0` only after `events.stop()`.
- Smallest fix: in the catch, also invoke the cleanup registered for that subscriber (keep a
  `WeakMap<Subscriber, () => void>` or store `detached` on the subscriber), so a failed enqueue
  tears the stream down exactly as `cancel()` does.

---

## Checked and clean (not counted)

- **SSE frame safety** (`events.ts:45-54`): data is `JSON.stringify`-encoded (control characters
  escaped), event names have CR/LF replaced with spaces. A plugin cannot forge a `data:` or `event:`
  line through either field. The `JSON.stringify` fallback on a circular value degrades to
  `"[object Object]"`, which is lossy but not injectable.
- **Ordering of ordinary frames** (`events.ts:90-102`): one frame string is built per emit and
  enqueued to every live subscriber in call order. The 20-frame test in
  `src/bridge/server-events.test.ts:24-48` still passes; this hunt found no reordering in `emit`
  itself. The ordering drift found is at the app-lifecycle fan-out above.
- **Drop policy is intentional and bounded** (`events.ts:21,95,140`): **measured** 296 emits into an
  unconsumed stream delivered 256 frames (numbers `0..255`); the 40 tail frames were dropped.
  `EVENT_HIGH_WATER_MARK = 256` is a deliberate memory bound, not an implementation fault. It does
  contradict the absolute byte-order claim in `src/plugins/pty-stream.ts:5-6,15-19` ("bytes reach
  the page in order"): a throttled page past the high-water mark loses a `pty-data` chunk with no
  signal, so terminal output can be silently corrupted. Changing the policy is a design call, not a
  defect fix; flagged here for the coordinator.
- **Client transports** (`invoke.ts:99-117,163-197`, `content-world-source.ts:35-64`): `attach`
  dedupes by name, the isolated world dedupes relays with `relaying[name]`, one listener set is
  installed per page client, and EventSource reconnects keep their listeners. The `once` reentrancy,
  `ready`-on-typed-failure and unsubscribe gaps are already reported in hunt-22/02 and are not
  re-counted.
- **Power/network listener installs** (`power-subscribe.ts:32-59`, `network-status.ts:77-103`,
  `darwin/power-events.ts:73-77`, `darwin/network-status.ts:77-96`): re-subscribing replaces the
  per-kind or per-adapter listener rather than stacking native observers. No duplicate-event or
  stale-listener defect found.
- **Reload watcher** (`events.ts:66-88`, `cli/dev/reload.ts:34-42,49-80`, `cli/dev.ts:177-184`):
  monotonic token, debounce on both sides, empty token ignored. The missing-parent-directory
  startup race is hunt-22/01 F2, unchanged and not re-counted.
- **Shell line ring** (`shell-stream.ts:17-32`): 500-line cap truncates old lines, never grows
  without bound; ordering of kept lines follows the drain loop.

## Not done

No full suite, build, typecheck or GUI probe. All four findings were derived from `read` plus short Bun
probes importing the real modules (navigation plugin with a fake adapter, `emitOnQuit`,
`watchLifecycle`, `Events` with one forced-throwing subscriber, and the 296-frame SSE drop check).
