# Runtime (src/ app*, runtime*, single*)

## Findings

### 1. A throwing `window-all-closed` listener leaves the app running with every window gone — HIGH
`src/app.ts:145`
`void emit(...).then(() => platform.quit())` calls `platform.quit()` only on fulfillment. `emit()` awaits every listener (`src/app-loop.ts:104`), so one listener that throws makes it reject: the `.then` never runs, `void` drops the rejection, and `watchWindows` already set `notified = true` (`src/app-loop.ts:169`) so it never retries. The pump timer (`src/app.ts:141`) keeps the process alive forever with no window on screen.
**Breaks:** closing the last window hangs the app instead of quitting it; the only error is an unhandled rejection.
**Evidence:** `void emit(this.#listeners, "window-all-closed").then(() => platform.quit());`

### 2. The launch-time crash guard never arms the handlers that write the record it reads — HIGH
`src/runtime-plugins.ts:151`
The runtime starts `startCrashGuard` (`:146`) but only exposes `crashNative.arm` as the `crash-reporter.install` command payload (`:185`); nothing calls it at launch. The C handler is what writes `crash-record.bin` before `_exit(70)`. With no `install` call from a page, a crashed app dies on the default signal disposition, leaves an empty record, and the guard records nothing. The crash guide claims "an app takes no step to get crash records".
**Breaks:** crash reporting is inert for any app that does not explicitly invoke `crash-reporter.install` from page code, although the runtime starts a guard for it.
**Evidence:** `arm: (recordPath: string) => crash.armCrashHandlers(recordPath)` is only passed into `createCrashReporterPlugin({ root: appRoot, guard, native: crashNative })`; `armCrashHandlers` has no other caller outside its own module and tests.

### 3. A guard that cannot be spawned is swallowed with no log — MEDIUM
`src/runtime-plugins.ts:147`
`startCrashGuard` is wrapped in a bare `catch { guard = undefined; }`. No warning is printed (contrast the bridge handshake failure, which logs at `src/runtime.ts:135`). Every `crash-reporter` command then answers `not-implemented` naming `startCrashGuard()`, so the user sees an empty crash feature with no clue the spawn failed.
**Breaks:** a failed guard launch silently disables crash recording for the whole app process.
**Evidence:** `try { guard = startCrashGuard({ appDataDir: appRoot }); } catch { guard = undefined; }`

### 4. `watchWindows` counts only config windows, so runtime-created windows are ignored — MEDIUM
`src/app-loop.ts:167`
The all-closed check reads `config.windows.some(...)` instead of the platform's live window set. `window.create` opens windows under arbitrary labels (`src/plugins/window-create.ts:19`) that are not in config. Closing every configured window while a page-created one stays open reports "all closed" and quits the app with a live window.
**Breaks:** a page that opens a second window with `window.create` is killed as soon as the configured window closes.
**Evidence:** `const open = config.windows.some((window: WindowConfig) => platform.window(window.label));`

### 5. `#started` is set before `platform.start()`, so a failed start bricks the app object — LOW
`src/app.ts:126`
`run()` sets `#started = true` then awaits `platform.start()`. If start throws, the flag stays true: a retry throws "already called", and `command()` / `use()` throw "after app.run() has started". The bridge created at `:123` may already be listening, and `startApp` stops it (`src/runtime.ts:158`), but the singleton cannot be reused.
**Breaks:** a transient platform-start failure leaves `app` permanently unusable in that process; no error path resets the flag.
**Evidence:** `this.#started = true; await platform.start();`

## Coverage
Read in full: `app.ts`, `app-loop.ts`, `app-types.ts`, `index.ts`, `runtime.ts`, `runtime-process.ts`, `runtime-options.ts`, `runtime-host.ts`, `runtime-shim.ts`, `runtime-plugins.ts`, `runtime-single.ts`, `runtime-crash-guard.ts`, `runtime-crash-store.ts`, `single.ts`, `single-detect.ts`, `single-build.ts`, `single-page.ts`, `single-runner.ts`, and every test file under those names. Also read (for context only, not reported) `src/cli/build/wrapper.ts`, `src/cli/framework.ts`, `src/bridge/server/handler.ts`, `src/plugins/crash-reporter.ts`, `src/plugins/window-create.ts`, `src/plugins/core.ts`, `src/platform/darwin/{platform,crash,crash-record}.ts`, and the crash-report docs page. Ran two single-file test invocations (`runtime-extensions.test.ts`, plus that with `plugins/plugins-mount.test.ts`) — both green, so no double-singleton bug reproduced there: bun isolates test files. Did not read the other 18 hunters' reports or any files outside this area beyond the context above. Next I would check whether the built single-file wrapper and the dev runner differ in the shape of an `invoke` result at the bridge client, and probe `app.run()` with an injected fake platform to confirm finding 5's recovery path.
