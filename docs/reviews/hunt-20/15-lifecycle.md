# Hunt 20 — app lifecycle

## HIGH — `before-quit` and `will-quit` never run on the normal quit path
- where: `src/app.ts:167-172`, `src/platform/darwin/platform.ts:166-185`, `src/platform/darwin/shim/117_lifecycle.c:35-45`, `src/runtime-process.ts:12-17`
- mechanism: (read) The all-windows-closed watch calls `platform.quit()` directly. Darwin `quit()` first calls `lifecycle().immediate()`, which sets `terminating = 1`; `-terminate:` then takes the `NSTerminateNow` branch that never records `BEFORE_QUIT` (C lines 39-45), and `process.exit(0)` at platform.ts:185 kills the process before the 250 ms lifecycle tick can drain any `WILL_QUIT` bit. SIGINT/SIGTERM call `process.exit(0)` with no event at all. Only an AppKit-initiated quit (⌘Q) records `before-quit` and defers, so the documented `await saveDraft()` in `before-quit` and the "last write" in `will-quit` are skipped on the path virtually every app uses to quit.
- reachable by: (read) Default template has `app.on("window-all-closed", …)`; closing the last window triggers the watch → `platform.quit()` → immediate terminate → exit. Docs promise the opposite at `site/app/docs/guides/lifecycle/page.mdx:36-42`.
- smallest fix: Emit `before-quit` and `will-quit` through the same `emit()` path before `platform.quit()` in the all-closed handler, with a guard so a native-deferred `before-quit` is not delivered twice; route SIGINT/SIGTERM through that path too (or at least give it a bounded drain).

## MEDIUM — `window-all-closed` listener registered after `run()` is silently dead
- where: `src/app.ts:106-111`, `src/app.ts:162-174`
- mechanism: (read + measured) `on()` deliberately has no `#started` guard, so registering after startup is legal. `run()` checks `#listeners.get("window-all-closed")?.size` exactly once and only then installs `watchWindows`. A listener added after `await app.run()` leaves no watch at all: every window can close, the listener never fires, and the pump keeps a windowless process alive. Measured with a fake platform: after `await app.run()`, `app.on("window-all-closed", …)`, clearing the open set and waiting 800 ms produced `heard 0`.
- reachable by: (read) Any entry that does `await app.run(); app.on("window-all-closed", handler)`, or registers the handler from a page invoke / delayed continuation.
- smallest fix: Install the watch unconditionally when there are windows to watch and check the listener set inside `onClosed` (or have `on("window-all-closed")` install the watch lazily once started).

## MEDIUM — A `ready` listener that awaits run-loop work deadlocks startup
- where: `src/app.ts:156-159`, `src/platform/darwin/platform.ts:64-79`, `src/platform/darwin/dialog.ts:86-96`
- mechanism: (read) `openWindows()` is followed by `await emit(listeners, "ready")`, and `platform.pump()` is called only after every ready listener settles. `pump()` is the only thing that drives Cocoa (`shim_pump` on a 16 ms timer), so a documented async ready listener that awaits a run-loop-dependent command — e.g. `dialog.open`, which returns `sheetStarted` and polls for the sheet — can never complete; `run()` never resolves and the UI never pumps.
- reachable by: (read) `app.on("ready", async () => { await window.crust.invoke("dialog", "open", {}) })`. Async ready listeners are shown in `site/app/docs/guides/window-state/page.mdx:33-37`.
- smallest fix: Call `platform.pump(PUMP_INTERVAL_MS)` immediately after `openWindows()`, before awaiting `ready` listeners.

## MEDIUM — A recycled PID in a stale lock blocks launch and raises a foreign app
- where: `src/plugins/single-instance-lock.ts:75-84`, `src/plugins/single-instance-lock.ts:127-146`, `src/plugins/single-instance.ts:56-73`, `src/runtime-single.ts:148-155`
- mechanism: (read) Liveness is only `process.kill(pid, 0)`; the lock file carries nothing but the pid. If the OS reuses that pid after a crash, `acquire()` reports the unrelated process as the live holder, so `startApp` refuses to launch and `quitSecondInstance` activates that pid via `NSRunningApplication`. `ACTIVATED_STATUS = 0` then prints `raised the running instance (pid N)` even though a different app was raised — no crust window ever opens and the log claims success.
- reachable by: (read) App crashes leaving `<id>.lock` with pid N (SIGKILL/sleep leaves the stale file by design); OS recycles N; user relaunches the app.
- smallest fix: Write a second token (process start time or a UUID) in the lock and verify it through an adapter before treating the pid as the holder; have `activate` check the raised process is this app's bundle before reporting `activated`.

## Checked and clean
- `attach`/`configure`/`deferBridge`/`run` reentrancy: (read) all three mutators throw once `#started` is set; `run()` refuses a second call. A throw from `platform.start()` leaves the flag set, but there is no retry path to protect and the exit hook still releases the lock.
- Single-instance claim/exit: (read) `claimSingleInstance` takes the lock before AppKit and registers one `process.once("exit")` drain keyed by path; explicit `release()` removes the key first, so a clean quit, SIGINT and SIGTERM all release exactly once and SIGKILL leaves a stale lock the next launch takes over. `runCrashGuardIfMarked()` runs before the claim, so a guard is never refused as a duplicate.
- Crash guard lifecycle: (read) `startCrashGuard` removes the old record before spawning, watches with liveness polling, and `watchCrashTarget` records only when a record exists; the guard exits on its own after a clean parent exit. (note) If the spawn fails, the old record has already been deleted and `startCrashPart` only warns — the last crash is lost, but the failure is named, so not a silent lie.
- `window-all-closed` emission: (read) the watch uses live `windowLabels()` (config labels only as a fallback), fires once via `notified`, and awaits all listeners before `platform.quit()`; a throwing listener is warned and still quits. Covered by `src/app-run.test.ts`.
- Lifecycle watcher: (read) `watchLifecycle` drains once per 250 ms, publishes page events before backend listeners, calls `settle()` in `finally` for `before-quit`, and stops polling after a typed refusal while surfacing it on `error` once. Tested in `src/app-lifecycle.test.ts`.
- Post-run lifecycle listeners: (read) unlike `window-all-closed`, lifecycle events fan out from the live listener map on every tick, so listeners added after `run()` do work; no watch-install race there.
- `suspend`/`resume`/`lock`/`unlock`: (read) these are not `AppEvent`s; they are the six `crust:power` push commands (`src/plugins/power-subscriptions.ts`). The app lifecycle surface makes no claim about them, so there is no missing app event to report.
- Quit and in-flight bridge calls: (read) `platform.quit()` calls `process.exit(0)` on all three platforms; pending page invokes are cut off. This is inherent to immediate termination and is not promised by the docs, so recorded as a note rather than a defect.
