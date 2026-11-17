# Lane R — `app:` events reach the page

## What was done
- `src/app-watch.ts`: `subscribePageEvents(sink)` / `clearPageEvents()` keep a module-level sink set; `publishPageEvent(event)` emits `app:<event>` with `{ event, at }`. `watchLifecycle` calls it in the same loop that awaits `app.on` listeners — one forward, so page and backend cannot drift.
- `src/runtime-app-namespace.ts`: `app.info` is a new command beside `app.invoke`; either handler arms the sink with its own `ctx.emit`. `info` is a command, not an `app:info` event, because the answer never changes and a page asks for it.
- Parity page row and `docs/agents/butter-coverage.md` F1 flipped to `same`.

## Traps
- The sink is module-level, not a field: no `App` owns a bridge handle's `emit`, and only the `app` namespace holds a `ctx.emit`. Same reasoning as `window-identity.ts`'s recorded token — one bridge per process, so no ambiguity.
- A sink that throws is named per event and costs neither other sinks nor the backend fan-out. A page sink is untrusted code fed from the lifecycle timer.
- The set is by identity, so repeat `app.info()` calls cannot grow it; a test that arms a sink must `clearPageEvents()` or leak into the next case.

## Tests
- `src/app-page-events.test.ts` — forward from the drain loop, throwing sink isolated, unarmed publish is a no-op, disarm stops delivery, `app.info` command arms the sink.
