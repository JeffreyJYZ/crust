# Lane F — lifecycle events

## What was done
- `src/app-types.ts`: `AppEvent` gains `activate`, `before-quit`, `will-quit`, `reopen`. `Platform.lifecycle?()` and `LifecycleSource` added. `unsupportedLifecycle(requires)` returns a source that throws `CrustError("not-implemented", …)` naming the missing concept.
- `src/app.ts` / `src/app-loop.ts`: `App.run()` drains the platform's lifecycle source on an unref'd 50 ms timer via `watchLifecycle`. A throwing listener is named and never blocks a deferred quit's `settle()`. `App.info()` returns `{ id, name, version, execPath, packaged }` (`packaged` false only for a bun/node/deno interpreter).
- `src/app-info.ts`: split out so `app.ts` stays under the 200-line cap.
- darwin: `shim/95_deeplink.c` keeps the one `CrustDeepLinkDelegate`; `shim/117_lifecycle.c` (concatenated into the same C unit) adds `applicationDidBecomeActive:`, `applicationShouldTerminate:` (returns `NSTerminateLater`, answered by `crust_lifecycle_settle`), `applicationWillTerminate:`, `applicationShouldHandleReopen:hasVisibleWindows:`. One bitmask drained by JS; no second delegate or compile.
- `src/platform/darwin/lifecycle.ts` decodes the mask and wraps the shim; `deep-link-unit.ts` holds the compile/FFI table (split out for the line cap). `DarwinPlatform.lifecycle()` returns the adapter.
- linux/windows `platform.ts`: `lifecycle()` returns `unsupportedLifecycle(...)` naming GTK focus / `WM_ACTIVATEAPP` — no faked events.

## Traps measured
- Adding methods to the deep-link delegate means both deep links and lifecycle share one `NSApplication` delegate. Installing a second delegate refuses (status 5) and would lose one set of handlers.
- The C unit must stay ONE translation unit: `117_lifecycle.c` calls `dl_has` from `95_deeplink.c`, so concatenation order (deeplink first) is load-bearing.
- `bun fmt` has no C parser; do not pass `.c` files to it.

## Tests
- `src/app-lifecycle.test.ts` — event fan-out, throwing before-quit still settles, throwing source skipped, `app.info()` shape.
- `src/platform/darwin/lifecycle.test.ts` — bitmask decode, drain + settle, static proof the delegate registers all selectors and the terminate reply.

## Not done here
- No parity row or guide page: `site/` was owned by another lane during this wave; the docs/parity lane must add the lifecycle row.
- `src/runtime-plugins.ts` briefly exceeded the 200-line cap from another lane's concurrent edit; not this lane's file.
