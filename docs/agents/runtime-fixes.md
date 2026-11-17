# runtime lane — fix wave

Lane `runtime`, owns `src/{app,app-loop,runtime,runtime-plugins,runtime-shim}.ts`.
Reports: `docs/reviews/defects-wave3/09-runtime.md` findings 1–4, and `19-config.md` finding 3
(the shared store, assigned here by `docs/reviews/fix-wave/LANES.md:26`).

## 09 #1 — fixed, `src/app.ts:145`

The close listener is now `emit(...).catch(warn).then(() => platform.quit())`.
`emit` awaits every listener, so one throw rejected the chain, `.then` never ran, `void` dropped the
rejection, and `watchWindows` had already set `notified = true` — the pump timer then kept a
windowless process alive forever. The failure is named in one `console.warn` and the app quits anyway.

## 09 #2 — fixed, `src/runtime-plugins.ts:140` (logic in the new `src/runtime-crash-start.ts`)

The darwin handlers are armed at launch, not only by a page's `crash-reporter.install`. Order is
`startCrashGuard` → `guard.running()` → `crashNative.arm(crashRecordPath(appRoot))`, so the record
`_exit(70)` writes exists for any app, and a page that still calls `install` gets an idempotent re-arm
with the same answer (`CRASH_STATUS.alreadyArmed`).

`runtime-plugins.ts` had reached 213 lines with these rules inline, so the ordering and the reporting
moved to `src/runtime-crash-start.ts` (62 lines) with the guard, the signal unit and the record path all
injected — the file holds no native call and its test spawns no process.

## 09 #3 — fixed, same place

The bare `catch { guard = undefined; }` now logs `  crash     the guard did not start, crash records
are off: <reason>`, matching the bridge handshake's shape at `src/runtime.ts:135`. A guard that
spawned but would not arm or had already exited is named too, because a record nothing writes is the
same empty feature.

## 09 #4 — fixed, `src/app-loop.ts:159`

`watchWindows` asks the platform for its live label set when it has one
(`platform.windowLabels?.()`), and only falls back to `config.windows` when it does not.
`window.create` opens windows under labels the config never names, so the old check reported "all
closed" and quit while a page-created window was still on screen. `windowLabels` is a new **optional**
member of `Platform` (`src/app-types.ts:25`) because it is the honest answer to "is anything still on
screen"; darwin (`platform.ts:130`) and windows (`platform.ts:160`) already implement it.

**Not fixed here / needs `linux`:** `src/platform/linux/platform.ts` has no `windowLabels()`, so Linux
still falls back to config labels. Its `#windows` map is exactly the set to return, but the file
belongs to the `linux` lane.

## 19 #3 — fixed, `src/runtime-plugins.ts:81`

`createStorePlugin({ root: appRoot })` where `appRoot = defaultStateRoot(appId ?? "crust")` is now
computed once at the top of `nativePlugins` (`:61`) and shared by the store, the crash record and the
guard. Before, the store was built with no adapter, so `defaultStoreRoot` fell back to the literal
`"crust"` and every crust app shared `~/Library/Application Support/crust/store.json` — a key set by
one app appeared in another and a `clear` in one erased the other's data. `defaultStateRoot` is now a
static import (it was a dynamic one after the darwin arm); the same `CRUST_DATA_DIR` override and the
same `app.id` folder as crash, downloads and window state.

## Tests added

- `src/app-run.test.ts` (new, 4 cases) — a throwing `window-all-closed` listener still quits the app
  once (`platform.quits === 1`), a resolving one hears the event once and quits once, a window opened
  outside the config keeps the app alive until it closes, and a platform without `windowLabels` still
  falls back to the config windows.
- `src/runtime-crash-start.test.ts` (new, 4 cases) — handlers are armed at launch with the computed record
  path; a guard that throws is named in one warning and leaves `guard` undefined; a guard that already
  exited is not armed; a native arm that refuses is named.
- `src/runtime-plugins.test.ts` — "the store file lives under the app's own id, not the literal crust"
  reads `store.keys` and asserts the answered `path` carries `land.jyz.store-alpha`, not
  `Application Support/crust/store.json`.

Red-then-green, measured by reverting each fix in place:

- `app.ts` back to `void emit(...).then(...)` → the throwing-listener case fails (`Expected: 1,
Received: 0`), 1 fail.
- `app-loop.ts` back to `config.windows.some(...)` → "a window opened outside the config keeps the app
  alive" fails (`Expected: 0, Received: 1`).
- `runtime-plugins.ts` back to `createStorePlugin()` → the store-path case fails.
- `runtime-crash-start.ts` is covered by its own file: the guard-throw case asserts the single warning line
  and `guard === undefined`, both of which the old bare `catch` could not produce (it printed nothing).

## Checks

`bun check src/app.ts src/app-loop.ts src/app-types.ts src/runtime-plugins.ts src/runtime-crash-start.ts`
→ no type errors. `bun test src/app-run.test.ts src/runtime-crash-start.test.ts src/runtime-plugins.test.ts
src/plugins/plugins-mount.test.ts src/plugins/store.test.ts` → 26 pass, 0 fail.
`bun run check:lines` → the two offenders are `src/packaging/extension-compile.test.ts` (265) and
`src/packaging/extension-bindings.test.ts` (222), both another lane's; every file here is ≤189.
`bun check` on the whole tree stops early on `src/packaging/nsis.ts:89` (a template literal in a
comment) and `src/plugins/shortcuts.ts:103` (`dispose` missing) — not this lane's files.
`bun fmt` was run with an explicit path list only.

## Durable notes

- An `emit` that awaits listeners must be followed by `.catch(...).then(quit)`; `void emit(...).then(quit)`
  turns one throwing listener into a process that never exits, and the watch has already latched.
- The all-closed check must read the platform's live window set, not the config: `window.create` labels
  are unbounded, so `config.windows` is only the launch-time subset.
- Per-app data must come from one place. `defaultStateRoot(appId)` is that place; a plugin built with no
  adapter silently falls back to a machine-wide root, and two apps then share a file.
- Crash reporting has two halves that must both be started at launch — the guard process _and_ the C
  handlers. Starting only the guard leaves a process that watches for a record nothing writes.
- A new `Platform` member that only some platforms implement belongs as optional (`windowLabels?()`),
  or the shim layer has to grow a stub per OS.
- Swallowing a spawn failure (`catch { guard = undefined }`) is indistinguishable from "no crashes";
  name the reason in one warning, the way `runtime.ts` does for the bridge handshake.
