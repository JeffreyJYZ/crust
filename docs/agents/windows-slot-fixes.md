# Windows slot/pump fixes

## Fixed

- **02-windows #2** — failed create leaked the slot and controller.
  - `window-open.ts`: the error path now calls `shim_webview_close(hwnd)` before
    `shim_window_destroy(hwnd)`. A failure before bind makes close a no-op, so the order is safe.
  - `shim/42_webview.c`: `shim_webview_close` now compacts `g_hwnd`/`g_ctrl` and decrements
    `g_windows`. `g_windows` is both the count and the append index, so merely zeroing a slot left
    a permanent hole; after eight failures every later `shim_webview_bind` returned 0 and every
    `createWindow` threw "WebView2 controller failed" for a refusal that never happened.
  - Tests: `window-open.test.ts` (close called once, before destroy; no close when CreateWindowExW
    itself failed), `shim-resources.test.ts` (compaction markers in the C).

- **02-windows #4** — `WM_SIZE` resized from an indeterminate rectangle.
  - `shim/20_class.c`: `if (!GetClientRect(hwnd, rect)) return 0;` before `put_bounds`, matching
    `shim_window_client_num` four lines below.
  - Test: `shim-resources.test.ts` asserts the guard precedes `shim_webview_put_bounds`.

- **11-probes #1** — smoke "pump" proved only Bun's timer.
  - `platform.ts`: new `#nativeMessages` counter and `nativeMessages` getter, fed by the return
    of `shim_pump()` (a message count, not a call count). `ticks` stays the JS cadence.
  - `scripts/windows-smoke.ts`: pump check is now `ticks >= 2 && nativeMessages >= 1`, with a
    detail line that states the messages actually dispatched. A stubbed `PeekMessageW` cannot pass.
  - Test: `platform-pump.test.ts` overrides `load()` with a shim returning 0 for its first two
    pumps, then 3; `nativeMessages` stays 0 while `ticks` climbs, then tracks the dispatches.

## Not fixed

- **02-windows #5** (`userDataDir`) — outside this lane's ownership. `WindowsPlatformConfig` and
  `WindowsPlatform` already carry the field; the break is upstream: `CrustConfig` has no
  `userDataDir` key (`src/config/types.ts:90-102`) and `loadPlatform` passes only
  `{ ...config, appName }` (`src/app-loop.ts:78`). Needs a config-schema key plus the app-loop
  pass-through. No code changed.

- **11-probes #3** ("still open") — already fixed in the current tree; the report is stale.
  `platform.window()` calls `WindowsRegistry.get()` (`windows-registry.ts:37-45`), which calls
  `isOpen()` → `shim_window_is_open` (`windows-registry.ts:64-69`) and prunes a dead HWND. The
  pruning is covered by `platform.test.ts:147-157`. The smoke was tightened anyway: its detail
  now names the HWND and the check also requires `nativeWindow("smoke") === hwnd`.

## Verification

- `bun check` — clean (631 files).
- `bun test` on `window-open`, `shim-resources`, `platform-pump`, `platform` — 26 pass, 0 fail.
- `bun fmt` on changed files — 0 changed, 6 unchanged.
- `bun run check:lines` — my files all under 200; two packaging files owned by another lane
  (`extension-compile.test.ts` 265, `extension-bindings.test.ts` 222) exceed the cap.
- No build, no suite, no e2e, no GUI probe.
