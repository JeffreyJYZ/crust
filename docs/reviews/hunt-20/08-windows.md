# Windows platform hunt

All claims below are `read` unless marked `measured`. Only the ABI test run was measured; nothing here
ran against real user32/WebView2.

## High — Title-bar close never calls `shim_webview_close`, so eight user closes permanently brick window creation
- where: `src/platform/windows/shim/20_class.c:49-56`; `src/platform/windows/shim/42_webview.c:9-11,62,155-169`; `src/platform/windows/destroy.ts:16-19`
- mechanism: `WM_CLOSE` in the window procedure goes straight to `DestroyWindow`; only the TypeScript paths (`destroy.ts`, `window-open.ts:107`, and the unused `teardown.ts`) call `shim_webview_close`, the sole function that removes the hwnd/controller slot and the min-size entry. Human closes leave both the `g_ctrl[8]` slot and the `g_min_*[8]` entry occupied with a dead hwnd. After eight, `shim_webview_bind` returns 0 at `g_windows >= SHIM_MAX_WINDOWS`, and every later `createWindow` throws (the new window is created then immediately destroyed). Win32 reuses HWND values, so a reused handle also matches the stale slot and `shim_webview_put_bounds` sizes a closed controller.
- reachable by: Open and title-bar-close eight windows (`X`, not `window.destroy()`), then call `createWindow` a ninth time. No JS close event exists — `lifecycle()` is `unsupportedLifecycle` — so nothing can relay the close back to `destroy()`.
- smallest fix: In `shim_wndproc`'s `WM_DESTROY`, call `shim_webview_close(hwnd)` and `shim_window_set_min(hwnd,0,0)` before `PostQuitMessage`, guarding against the TypeScript path having already closed it (both are idempotent on a missing slot).

## Medium — A close during the nested message pump destroys the window under an in-flight `shim_webview_new`
- where: `src/platform/windows/shim/30_com.c:147-156`; `src/platform/windows/shim/32_env.c:110-119,154-159`; `src/platform/windows/shim/42_webview.c:139-152`; `src/platform/windows/shim/20_class.c:49-56`
- mechanism: `handler_wait` pumps with `PeekMessageW` synchronously on the Bun thread while waiting for the environment/controller completion; there is no reentrancy guard. `shim_pump` dispatches thread-wide, so a `WM_CLOSE` delivered during that wait runs `DestroyWindow` + `PostQuitMessage` while `shim_webview_new` is still on the C stack. It then binds a controller to a dead HWND and navigates it.
- reachable by: Click the window's X during the up-to-5 s `shim_env_wait` / `shim_controller_wait` on first window creation. The resulting error from `openWindow` names a GetLastError/vtable state, not the close that caused it.
- smallest fix: Set a `g_pumping_reentrant` flag around `handler_wait`'s drain and have `WM_CLOSE` defer (post to self) while set; and check `IsWindow(g_ctrl_hwnd)` after each wait before binding.

## Medium — `crust:screen.list()` reports `scale: 1` on every high-DPI Windows display
- where: `src/platform/windows/shim/47_screen.c:65`; `src/platform/windows/screen.ts:8,40`
- mechanism: The shim writes `entry->scale = 1.0` unconditionally; the adapter turns any non-finite/non-positive value into `1`. On a 150% display the plugin returns scale 1, so a page positioning or sizing UI from `screen.list()` gets a wrong answer with no error.
- reachable by: Any `crust:screen.list()` call on Windows with display scaling other than 100%.
- smallest fix: Load `GetDpiForMonitor` from shcore.dll alongside the user32 bindings and set `scale = dpi / 96` (fall back to 1 only when the call fails), adding the module to the preflight table.

## Low — Stale fullscreen record can be applied to a reused HWND
- where: `src/platform/windows/window-fullscreen-adapter.ts:34-39,64-81`
- mechanism: The `fullscreen` map is keyed by hwnd and only cleared by `setFullscreen(label,false)`. A title-bar close (finding 1) leaves the record behind; when Windows reuses that hwnd for a new window, `setFullscreen(newLabel,false)` restores the *old* window's style and frame onto the new one. The comment at line 35 only covers `isFullscreen` and the `true` branch, not this one.
- reachable by: Fullscreen window A, close it with X, create window B that reuses the handle, call `setFullscreen("B", false)`.
- smallest fix: Key the record by label as well as hwnd, or drop entries on a close/registry prune; verify the stored style before restoring.

## Wart — The dialog FFI table is outside the arity/width audit
- where: `src/platform/windows/ffi-abi.test.ts:22-24`; `src/platform/windows/ffi-dialog.ts:15-25`
- mechanism: `bindings` only includes `ffi.ts` and `*-ffi.ts`, so `ffi-dialog.ts` is skipped by "every declared symbol exists", arity and return/argument width checks. `dialog-abi.test.ts` audits the *C pointer declarations* but not the six `bun:ffi` entries. `measured`: `bun test` on the four Windows ABI test files passed 21/21, so today's declarations match — the gap only lets a future drift pass silently.
- reachable by: A future edit to `ffi-dialog.ts` with a wrong arg width; no gate catches it.
- smallest fix: Include `ffi-dialog.ts` in the `bindings` filter (e.g. `name === "ffi.ts" || name.includes("-dialog") || name.endsWith("-ffi.ts")`).

## Checked and clean
- **`GetWindowLongPtrW` vs `GetWindowLongW`**: `10_prelude.c:13-14` declares both `GetWindowLongPtrW` and `SetWindowLongPtrW` as `shim_i64` (LONG_PTR); `12_win32.c:71-72` binds only the Ptr variants; `GetWindowLongW` is never bound. `abi-width.test.ts:97-98` pins that verdict. Styles themselves are read as 32-bit `int` (`45_style.c:32-35`) after the Ptr read — correct for GWL_STYLE/GWL_EXSTYLE on LLP64.
- **Struct layout across FFI**: `shim_msg` is 6×8=48 bytes, matching MSG on x64/arm64 (`10_prelude.c:174-176`); `shim_window_placement` is 44 bytes with the right member offsets (`11_win32_style.c:24-38`); `MINMAXINFO.ptMinTrackSize` is at int index 6/7 (`20_class.c:32-41` — the comment says "fifth POINT" but the offset 24 is right); `shim_monitor_info` is 104 bytes (`47_screen.c:12-23`); `MEMORY_BASIC_INFORMATION` State/Protect offsets 32/36 (`14_guard.c:12-35`); `shim_rect` is four 32-bit LONGs and is passed by pointer on x64, by value on arm64 (`34_slots.c:9-35`). No struct crosses the bun:ffi boundary by value.
- **bun:ffi width and arity**: The C definitions and every binding in `ffi.ts`, `ffi-core.ts`, `notify-tray-ffi.ts` and `keychain-ffi.ts` agree; `measured`: 21 tests across `ffi-abi.test.ts`, `abi-width.test.ts`, `dialog-abi.test.ts`, `notify-tray-abi.test.ts` pass. `CoInitializeEx`/`CoGetApartmentType` are correctly declared `int`, not `shim_i64` (`10_prelude.c:33-35,66-68`).
- **WM_SIZE / WM_DPICHANGED**: `WM_SIZE` uses `GetClientRect` rather than LPARAM (`20_class.c:23-30`), which is right for a DPI change with stale LPARAM. There is no `WM_DPICHANGED` handler; `DefWindowProcW` gets it. With WebView2's default `COREWEBVIEW2_BOUNDS_MODE_USE_RAW_PIXELS` (docs read) and physical-pixel bounds from `GetClientRect`, sizing is on the correct unit, so this is a limitation, not a wrong-size defect. The shim never sets bounds mode, leaving WebView2's default interpretation in force.
- **COM refcounts**: Environment/controller/webview objects are AddRef'd in `handler_invoke` (`30_com.c:71-85`) and deliberately never Released (`30_com.c:59-60`) for process lifetime. A process-lifetime policy, not a per-window leak by itself — the leak that matters is the unreclaimed slot in finding 1.
- **32-bit build**: Explicitly out of scope (`10_prelude.c:5`, `c-abi.ts:6-8`). On x86 a pointer is 4 bytes, so `cWidth("shim_h")==8`, the 48-byte `shim_msg`, and `GetWindowLongPtrW` (a macro, not an export on x86) would all be wrong. The failure is fail-closed: `SHIM_BIND(GetWindowLongPtrW)` returns 0, `shim_win32_ready()` is 0, and `startWindows` reports the machine unavailable (`startup.ts:26-31`) before any window call. No silent x86 behaviour.
- **WM_QUIT**: Every `WM_DESTROY` calls `PostQuitMessage`, including for a non-last window. `shim_pump` drains and ignores the message content (`10_prelude.c:180-190`), so no JS loop is stopped by it and no stale quit flag survives. The pump is stopped by `platform.quit()` (`platform.ts:170-181`), not by Win32.
- **`teardown()`**: Defined at `teardown.ts:10-20` but never called (`quit()` uses the `destroy()` per-label loop). Dead code, not a live double-destroy path.
