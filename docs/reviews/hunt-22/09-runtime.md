# Hunt 22 — app runtime and lifecycle

Scope: `src/app.ts`, `src/app-loop.ts`, `src/runtime*.ts` and the helpers they call directly for the
paths below. All findings are `read` from source and its tests; no binary was launched, no GUI probe
ran, and no file was changed. `hunt-21/15-lifecycle-processes.md` was read first; its fixed items
(quit events, guard token, child reaping) are not re-reported as new, but one residual is named
below.

## MEDIUM — `app.use()` accepts built-in namespaces that the bridge then refuses at startup

- where: `src/app-loop.ts:30-39,146-170`; `src/runtime.ts:102-108`; `src/runtime-plugins.ts:150-199`;
  `src/runtime-feature-plugins.ts:34-70`; `src/plugins/registry.ts:24-37`;
  `src/plugins/plugins-mount.test.ts:87-94`.
- mechanism: `RESERVED_PLUGIN_NAMES` holds only `app`, `window`, the six `corePlugins` (`fs`,
  `dialog`, `notification`, `tray`, `autostart`, `logging`, plus `testing` when gated) and
  `stronghold`. `mountable()` rejects exactly that set. The runtime registry, however, also registers
  `clipboard`, `opener`, `os`, `shortcuts`, `window-state`, `positioner`, `screen`, `menu`, `theme`,
  `dock`, `power`, `accessibility`, `navigation`, `findinpage`, `downloads`, `network`,
  `crash-reporter`, `i18n`, `keychain`, `deep-link`, `store`, `database`, `shell`, `sidecar`,
  `updater`, `preview`, `browser`, optional `pty` and `single-instance`. `PluginRegistry.register()`
  throws `plugin "<name>" is already registered` on the second name. `startBridgeFor()` registers
  the runtime plugins first and `app.plugins()` second, so the collision is raised from `run()`,
  not from the `use()` call the comment promises ("a built-in ... is refused rather than shadowed").
- reachable: a project calls `app.use(definePlugin({ name: "shell", commands: { ... } }))` in
  `main.ts`, or `name: "clipboard"`, `keychain`, `preview`, `browser`, `deep-link`. Every one of
  those passes `use()` and freezes, then `startApp()` throws during `app.run()` with the registry
  error. The existing test at `plugins-mount.test.ts:87` checks only the core four plus `window`
  and `app`, so the gap is not covered. `RESERVED_EXTENSION_NAMES` in `src/extensions/define.ts:13`
  aliases the same incomplete set, so generated extensions have the same hole.
- smallest fix: derive the reserved set from the names the runtime actually registers (or pass that
  set into `mountable`) instead of hand-listing core plugins; add a test that mounts `shell` and
  expects `app.use` to throw.

## MEDIUM — a deep-link URL that fails validation is thrown from `app.run()` and from a pump timer

- where: `src/app-loop.ts:124-141`; `src/app-deep-link.ts:39-47`; `src/plugins/deep-link.ts:68-77,93-105`;
  `src/platform/darwin/deep-link.ts:85-113,139-147`.
- mechanism: `installLaunchDeepLink()` calls `queueDeepLink(launched)` during `run()` and again from
  an unref'd `setInterval` on every `takePendingUrl()`. `queueDeepLink()` calls `link.launch(url)`
  / `link.open(url)` with no guard. `createDeepLink().accept()` throws `TypeError` for a relative
  URL (`parseDeepLink`) and for a scheme that differs from `config.build.urlScheme`
  (`deep-link.ts:95-99`). The native argv scanner accepts any RFC-3986 scheme
  (`95_deeplink.c:121-147`, reached through `darwinDeepLinkAdapter().takeLaunchUrl`) and writes it
  into the same process-wide buffer the drain timer reads; no platform-side scheme filter exists.
- reachable: a direct launch with any URL argument that is not the configured scheme makes
  `app.run()` reject after the windows have been created and before `platform.pump()` is called.
  A later URL that fails the same check throws inside the interval callback, with no `try` around
  `queueDeepLink` and no `catch` on the timer, so one bad URL is an uncaught exception in a live
  run. Neither path names the URL as a refused deep link; the error surfaces as a startup or timer
  failure.
- smallest fix: validate and refuse inside `queueDeepLink` (log and drop a foreign/malformed URL),
  and wrap the drain callback so a rejected link cannot escape the timer; keep `launch()` for the
  startup path only after validation succeeds.

## MEDIUM (startup) — a failure after `platform.start()` leaves a started platform and created windows with no pump or bridge

- where: `src/app.ts:137-170`; `src/app-loop.ts:110-118`; `src/runtime.ts:172-178,188-197`.
- mechanism: `App.run()` sets `#started`, calls `platform.start()`, opens every configured window,
  then awaits `emit(this.#listeners, "ready")`. `emit()` awaits each listener with no error
  isolation (contrast `emitOnQuit()` and the lifecycle watcher, which both catch). A throwing
  `ready` listener rejects `run()` before `platform.pump()`, before the lifecycle/watch intervals
  are installed and before `#quitter.timers()` is armed. The entry import then rejects;
  `startApp()` responds with `await bridge?.stop()` only — it never calls `platform.quit()` and
  never closes the windows it just created. The CLI `catch` only sets `process.exitCode = 1`.
- reachable: any `app.on("ready", ...)` listener that throws (a typo in a startup save, an
  unreachable service) or any statement after `await app.run()` that throws. The observable state
  is a platform that already started, windows that were logged as created, a stopped bridge and no
  pump — pages cannot invoke anything and no quit watch exists, so closing the windows cannot
  terminate the app through the framework.
- smallest fix: isolate `ready` listeners the same way quit listeners are isolated, and make the
  `startApp` entry-error path undo a partially started run (`platform.quit()` / close windows) in
  addition to stopping the bridge.

## LOW — a quit begun during `ready` installs the watches after the quitter has already cleared them

- where: `src/app.ts:149-169`; `src/app-quit.ts:28-62`.
- mechanism: `createQuitter().begin()` clears `windowCheck` and `lifecycleCheck` and sets
  `quitting = true`. `App.run()` calls `#quitter.timers(windowCheck, lifecycleCheck)` only at the
  very end, after `await emit(..., "ready")`. `App.on()` has no post-start guard, so a `ready`
  listener may call `app.quit()`; that quit clears both handles while they are still `undefined`,
  then `run()` assigns the freshly started intervals into a quitter that will never clear them.
  Any later quit sees `quitting === true` and returns early, so those intervals survive the quit.
  They are unref'd, so the symptom is a leaked watch rather than a hung process; the
  `window-all-closed` callback also silently declines to run because `begin()` returns false.
- reachable: `app.on("ready", () => app.quit())`, or a `ready` listener that calls a command which
  quits. A unit test would only need a fake platform and a `ready` listener that quits, then assert
  the quitter's handles are cleared after `run()` resolves.
- smallest fix: arm the quitter with its timers before emitting `ready`, or have `timers()` refuse
  assignment when quitting has already begun.

## MEDIUM — the crash guard's token does not close the recycled-pid window after a real crash

- where: `src/runtime-crash-guard-watch.ts:26-34,60-70`; `src/runtime-crash-guard-token.ts:28-46`;
  `src/runtime-crash-guard.ts:125-128`.
- mechanism: the token is removed only in the armed parent's clean-exit handler
  (`startCrashGuard`'s `process.once("exit")`). On a fault the C handler `_exit`s, so the token
  stays by design — that is what tells the guard a crash happened. The watch loop is
  `while (alive(pid) && guardTokenHeld(...))`, where `alive()` is only `kill(pid, 0)`. There is no
  check that a still-live pid is the process that armed the token. If the OS reuses the pid before
  the next 100 ms poll, the loop continues against the new process with the old token still held.
- reachable: app faults (record written, exit code 70), a new process takes the same pid before the
  next tick and lives for minutes. The guard stays alive next to a dead app and, when that new
  process ends, records the old crash record again under the new process's observed time. This is
  the residual of `hunt-21/15`'s recycled-pid finding: the token fixes a clean exit and a stale
  guard after it, but not a reuse that happens after a crash. PID reuse within 100 ms was not
  measured here.
- smallest fix: persist a second identity that can be checked on every tick (process start time,
  or a guard-owned generation in the record) and stop watching as soon as the armed process is
  gone, not whenever `kill(pid, 0)` still succeeds.

## LOW — a guard that fails while recording a crash has no error path

- where: `src/runtime-crash-guard.ts:146-150`; `src/runtime-crash-store.ts:32-40`;
  `src/runtime-crash-write.ts:66-101`.
- mechanism: the guard's entry is `void watchCrashTarget(target).then(() => process.exit(0));` with
  no `.catch`. `recordCrash()` reaches `mkdirSync`, `appendFileSync`, `writeFileSync` and `rotateLog`,
  any of which can throw (permission change, full disk, torn root). A rejection then leaves an
  unhandled promise and no `process.exit`; nothing writes a diagnostic, and the parent has no way
  to observe that a crash it watched was lost.
- reachable: a user changes the data directory's permissions or fills the disk between launch and
  the watched process's death. The guarded app is already gone, so the only process that could have
  recorded the fault exits or hangs without a record.
- smallest fix: `.catch()` the watch, print one named line and exit non-zero; make `writeRecord`
  report which file failed instead of letting the raw filesystem error escape.

## Checked and clean

- Quit event order and one-shot guard: `app-quit.ts:17-26` emits `before-quit` then `will-quit` via
  `emitOnQuit`, which catches listener throws; `app-window-watch.ts:16-26` uses `begin()` before the
  emit chain, so a template listener that also calls `app.quit()` cannot start a second quit.
- Lifecycle watcher: `app-watch.ts:131-182` catches a refusing source once, forwards it to
  `app.on("error")` or the log, stops polling, and calls `source.settle()` in `finally` for
  `before-quit`. Page sinks are deduplicated by identity (`subscribePageEvents`:40-45).
- Bridge bind: `runtime-host.ts:24-47,74-119` derives a stable port, walks 20 neighbours then an
  OS-assigned port, and publishes a per-label document token under `0600` outside the served root.
  The shim (`runtime-shim.ts:12-27`) is injected into the served HTML before the bootstrap is
  added and is nonce-stamped with it; the two-argument `invoke` rewrite is installed before page
  scripts run.
- Single-instance launch order: `runtime-single.ts:119-178` takes the lock before the platform is
  built, opts out on `CRUST_SINGLE_INSTANCE=0` / headless / non-darwin, releases on `exit`, and a
  refused launch only raises the holder (`quitSecondInstance`:192-200).
- Crash store: `runtime-crash-write.ts:37-82,88-149` caps the log at 200 lines and each page field
  at 8192 chars, writes both files `0600` and tightens an older mode; `runtime-crash-store.ts`
  readers tolerate torn lines and absent files.
