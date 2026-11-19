# Windows shim and notification C sources — lifetime and threading (28)

Read-only hunt. Scope: the numbered Windows shim translation units under
`src/platform/windows/shim/`, the Windows notification/tray unit (`60`/`61`/`62`), and the Linux
notification/tray unit (`80`/`81`) with the TS edges that call them. The brief names
`src/platform/windows/shim.c`; that monolith no longer exists — `shim-source.ts` and
`notify-tray-source.ts` concatenate the numbered parts into the two compilation units, so those
parts are the current form of the named file.

**Count: 6 findings** (2 high, 3 medium, 1 low).

**Worst: F1 — the tray menu is a nested modal loop run from inside the window procedure that the
app's pump dispatches. It freezes the whole JS thread for an unbounded time and re-enters on a
second tray click.**

---

## F1 (high, worst) — `TrackPopupMenu` modal loop inside `shim_pump`'s dispatch freezes JS and re-enters

- `src/platform/windows/shim/62_tray.c:22-29` — `shim_tray_proc` calls `shim_tray_menu_open(hwnd)`
  synchronously from the `WM_TRAY` branch of the window procedure.
- `src/platform/windows/shim/62_tray.c:64-66` — `shim_tray_menu_open` calls `TrackPopupMenu` with
  `TPM_RETURNCMD`. That call runs a nested, modal message loop and does not return until the human
  picks a row or dismisses the menu.
- `src/platform/windows/shim/10_prelude.c:180-190` — `shim_pump` dispatches the tray message via
  `DispatchMessageW`; `src/platform/windows/platform.ts:93-106` — the app's pump is a
  `setTimeout` chain that calls `shim_pump()` and `pollTrayTick()` on the same JS thread.

**Reached:** a human right-clicks the tray icon. The FFI call blocks the JS thread inside the
nested loop, so no timer fires, no bridge request is served, and no in-flight invoke progresses
until the menu closes — the app looks hung for as long as the menu stays open. While the loop is
running, any further `WM_TRAY` message that `TrackPopupMenu` dispatches re-enters
`shim_tray_proc` → `shim_tray_menu_open`, opening a second modal menu; both frames write the same
`g_click` (`62_tray.c:69`) and post `WM_NULL` (`62_tray.c:67`), so the recorded click can be
overwritten by the later frame's dismissal. `48_dialog.c:10-13` acknowledges this exact cost for
file dialogs; the tray path has no corresponding warning or mitigation.

---

## F2 (high) — hidden tray window has no thread affinity; `DestroyWindow` failure is discarded

- `src/platform/windows/shim/61_notify.c:9-24` — `shim_hidden_window` creates the hidden window on
  whichever thread first calls `shim_notify_post` or `shim_tray_show`; nothing records that thread.
  The comment at `60_notify_tray.c:11-13` asserts it is "the same thread Bun owns", but no check
  enforces the assertion.
- `src/platform/windows/shim/62_tray.c:138-148` — `shim_tray_destroy` calls `DestroyWindow(g_hwnd)`
  and unconditionally sets `g_hwnd = 0`, ignoring the return.
- `src/platform/windows/shim/10_prelude.c:184` — `shim_pump` uses `PeekMessageW` with `hwnd = 0`,
  which retrieves messages only for windows on the *calling* thread's queue.

**Reached:** any notify/tray FFI call made from a thread other than the one running
`shim_pump` (a Bun worker, or a future plugin that posts off the main thread). The window is
created on that other thread; the main thread's pump never sees its `WM_TRAY`/`WM_COMMAND`
messages, so `g_click` is never updated and menu clicks are silently lost. A later
`tray.destroy` on the main thread calls `DestroyWindow` on a window owned by the other thread:
Win32 refuses it, the return is discarded, and `g_hwnd` is zeroed anyway. The window, its
message queue, the registered `"CrustNotifyTray"` class (`61_notify.c:22`, never unregistered)
and the shell icon callback then leak for the process, and a later `show` builds a second window
while the first is still live. The window shim already has the exact measurement primitive for
this class of bug — `shim_window_thread` at `40_window.c:117-120` — but the tray unit never
calls it.

---

## F3 (medium) — `g_added` latch never re-adds the shell icon after an Explorer restart

- `src/platform/windows/shim/61_notify.c:27-35` — `shim_icon_ensure` returns immediately when
  `g_added` is 1; it does not query the shell.
- `src/platform/windows/shim/61_notify.c:45-50` — `g_added` is only set on a successful `NIM_ADD`.
- `src/platform/windows/shim/62_tray.c:115-118,121-134` — `shim_tray_show`/`shim_tray_hide` read and
  clear the same flag; only `NIM_DELETE` through our own `hide` clears it.

**Reached:** Explorer/taskbar restarts (common after a shell update or crash) discard the tray
icon without going through this code. `g_added` stays 1, so `shim_notify_post` skips re-adding and
its `NIM_MODIFY, NIF_INFO` call fails; it returns status 3 ("shell refused") for the rest of the
process, and `tray.show` returns success without restoring an icon.

---

## F4 (medium) — `shim_notify_load` caches the first failure forever

- `src/platform/windows/shim/60_notify_tray.c:165-196` — `shim_notify_load` sets `g_state = -1`
  before binding, and every later call short-circuits on `if (g_state)`.
- `src/platform/windows/shim/60_notify_tray.c:168-172,188-193` — a transient `LoadLibraryA`
  failure for `user32.dll`/`shell32.dll` is indistinguishable from a missing module.

**Reached:** the first `notification.post` or `tray.*` call happens before the DLL search path is
final (or while the machine is briefly low on resources). The unit latches `-1`; notifications
and tray stay disabled for the process even after the precondition is satisfied. This is the
same "cache the earliest, worst-timed answer" shape as F4 in `10-ordering.md`, in the C layer.

---

## F5 (medium) — `shim_controller_begin` resets a handler WebView2 may still be using

- `src/platform/windows/shim/32_env.c:167-178` — `shim_controller_begin` calls
  `handler_init(&g_ctrl_handler, ...)` whenever `g_ctrl_requested` is false or `g_ctrl_hwnd`
  differs from the requested `hwnd`.
- `src/platform/windows/shim/30_com.c:114-131` — `handler_init` overwrites `refs`, `result`,
  `failed` and `done` on a static object whose address WebView2 retains until its completion fires.
- `src/platform/windows/shim/32_env.c:143-147` — `shim_env_begin` sets a fresh `g_ctrl_hwnd` for
  the new window, so the guard at `32_env.c:169` no longer matches the earlier request.

**Reached:** two `createWindow` calls whose controller creations overlap (a second window opened
while the first controller callback is still pending). The second call re-initialises the same
handler object in place; the first creation's `Invoke` later writes `created`/`result`/`done`
into the reset object, so `shim_controller_handle()` (`32_env.c:65`) can hand the first window
the second window's controller or a half-reset one. `30_com.c:36-44` also leaves the refcount
inconsistent: `QueryInterface`/`AddRef`/`Release` operate on the reset value, and nothing ever
balances the WebView2-side reference.

---

## F6 (low) — `g_web` is a single global with no per-window identity and is never cleared on close

- `src/platform/windows/shim/42_webview.c:12,73` — `g_web` is overwritten by every
  `shim_webview_bind`; `g_ctrl` is per-hwnd (`42_webview.c:10-11`) but `g_web` is not.
- `src/platform/windows/shim/42_webview.c:40-52,111-132` — `shim_webview_handle`,
  `shim_webview_vtbl`, `shim_webview_slot`, `shim_webview_navigate`, `shim_webview_navigate_string`
  and `shim_webview_source` all use `g_web` with no hwnd argument.
- `src/platform/windows/shim/42_webview.c:160-174` — `shim_webview_close` closes the controller
  and frees the slot but never clears `g_web`.

**Reached:** after closing the window whose webview was current, the probe/doctor exports
(`shim_webview_source`, `shim_webview_vtbl`, `shim_webview_slot`, `shim_webview_handle` — declared
in `backend-webview.ts` and `ffi.ts`) dereference a closed webview. With two windows open, every
one of those exports reports the last-bound window regardless of which window the caller means.
Product navigation is safe today only because `shim_webview_navigate` is called inside
`shim_webview_new` immediately after its own bind (`42_webview.c:155-157`); the exports themselves
carry no such guarantee.

---

## Worst

F1. It is the only finding that is both unconditional on the product path and user-triggerable
without any unusual setup: one right-click on the tray icon blocks the JS thread for an unbounded
time inside a nested modal loop that `shim_pump` entered, and a second click during that loop
re-enters the same code and corrupts the recorded click. F2 has a worse end state (leaked window
and class) but needs a non-main-thread FFI call, which current product code does not make.
