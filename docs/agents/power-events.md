# Lane H — power events (Butter parity wave 2)

## What landed

- `src/plugins/power.ts` + `power-types.ts` + `power-subscribe.ts`: `POWER_COMMANDS` now six —
  `onSleep` / `onLock` register a native observer and emit `power:sleep` / `power:lock` via `ctx.emit`.
  Page uses `crust.invoke("power", "onSleep")` then `crust.listen("power:sleep", fn)`.
- Absent adapter **or** missing adapter method → typed `not-implemented` naming the notification
  (`NSWorkspaceWillSleepNotification`, `com.apple.screenIsLocked`). Never a listener that never fires.
- `src/platform/darwin/shim/116_power_events.c`: joined with `105_power.c` by `power-ffi.ts` into one
  translation unit. Runtime `NSObject` subclass (`CrustPowerObserver`) with two selectors, one sink
  carrying kind 1 sleep / 2 lock. Added `-framework AppKit` — `NSWorkspace` lives there, not Foundation.
- `src/platform/darwin/power-events.ts`: one `JSCallback` per process; re-arming a kind replaces its
  listener. `fire(kind)` is a test seam sharing the same dispatch (and the same throw-catching) as the
  trampoline.
- `src/runtime-plugins.ts`: non-darwin branch now registers the adapter-less `powerPlugin` so the
  refusal is reachable instead of an unknown-plugin error.

## Traps worth keeping

- `fire` must go through the same dispatch as the JSCallback, or the "throwing listener" test passes
  for the wrong reason — calling the listener directly let the throw escape.
- `bun fmt` on power.ts pushed it to 201 lines; split the subscribe helper out rather than trimming
  the header that records the assertion-leak reason.
- An `edit` whose `oldString` is `createI18nPlugin, deepLink }` matches the **darwin** destructure in
  runtime-plugins.ts, not the earlier one — both blocks are identical. Anchor on `createStorePlugin`
  instead.
- `check:lines` red during this wave on other lanes' files (`app-loop.ts`, `app.ts`, `deep-link.ts`,
  `shim/95_deeplink.c`); none are Lane H's.

## Not done here

- Parity row and guide page: `site/` belongs to another lane; not touched.
