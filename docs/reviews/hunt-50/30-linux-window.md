# hunt-50 · Linux window adapter — events/answers that never arrive (30)

Read-only hunt. Scope: `src/platform/linux/window*.ts`, plus the shim C and plugin contract each file
calls into, because the bug is only visible across that seam. No GTK on this machine: every claim is
from `read` of code, not a runtime measurement.

**Count: 5 findings** (1 high, 2 medium, 2 low).

**Worst: F1 — a relative `window.create` resolves against the alphabetically-first open window's
origin, including a foreign one previously opened by the page, and carries the bridge token there.**

---

## F1 (high, worst) — `documentBase()` picks an arbitrary window's origin; a relative create can load a foreign origin with the bridge token in the URL

- `src/platform/linux/window-adapter.ts:46-60` — `documentBase()` walks `platform.windowLabels()` and
  returns the **first** open window whose URL matches `/^https?:/i`. It never checks that the origin
  is the app's own document.
- `src/platform/linux/platform.ts:119` — `windowLabels()` returns `live.sort()`: the iteration order is
  **alphabetical by label**, not creation order and not the calling page's window.
- `src/platform/linux/window-adapter.ts:63-66` — `resolveDocument()` joins a relative URL against
  that arbitrary base.
- `src/plugins/window-create.ts:60-73` — for a relative URL the plugin builds `appDocument()` and
  appends `?token=<bridge-token>` (`window-identity.ts:147-158`) while the URL is still relative, so
  the credential rides along into the `new URL(url, base)` join.

**Reached:** (1) A page calls `window.create({ label: "aaa", url: "https://external.example/" })` —
an absolute foreign URL passes through untouched (`window-create.ts:52-53,73`); window `aaa` is now
tracked with a foreign origin. (2) The page calls `window.create({ label: "child", url: "/about" })`.
(3) `documentBase()` sees labels `["aaa", "main"]` sorted, finds `aaa` first with
`https://external.example/`, and uses it as the base. (4) `child` loads
`https://external.example/about?window=child&token=<bridge-token>`. Result: the wrong document loads
**and the bridge bearer token is disclosed to a foreign origin**, while `window.create` answers
`{ok:true, created:true}`. The token leaves the app's own origin even though `window-identity.ts:83-95`
exists precisely to prevent that ("the token never leaves the app's own origin"). Even without the
token, any two windows on different origins make relative resolution non-deterministic (label sort).

---

## F2 (medium) — `isOpen` can never answer `false`; a user-closed window returns an `unknown-window` failure

- `src/platform/linux/window-adapter.ts:110-113` — `isOpen` is `require(label); return true`. `require`
  (`:29-38`) throws `unknown-window` for any label the platform no longer tracks.
- `src/platform/linux/platform.ts:129-137` — `nativeWindow()` **prunes** an entry when
  `backend.isOpen(win)` is false, so a closed label is indistinguishable from one never created.
- `src/platform/linux/shim/40_window.c:51-54,77` — GTK's `destroy` signal clears the C slot, so
  `shim_window_alive` reports 0 after the user closes the window.
- `src/plugins/window-args.ts:145-168` — `knownWindow()` explicitly expects `isOpen` to answer
  `false` for a label that is held but not in `list()`; Linux instead throws and it returns
  `unknownWindow(label)`.

**Reached:** page creates window `main`; the user closes it via the WM (GTK `destroy` clears the slot);
the page polls `window.isOpen({ label: "main" })`. `list()` no longer contains `main`, `knownWindow()`
probes `native.isOpen("main")`, `require` throws, and the page receives
`{ok:false, code:"unknown-window"}` — never the `{ok:true, open:false}` the contract in
`window-types.ts:47-53` describes. A page cannot detect "this window was closed" as a normal state; a
closed label looks like a caller bug. Every other platform's adapter returns a real boolean here.

---

## F3 (medium) — GTK focus/delete/window-close events never reach `app.on` on Linux

- `src/platform/linux/platform.ts:163-170` — `lifecycle()` unconditionally returns
  `unsupportedLifecycle("GTK window focus and delete-event notifications")`.
- `src/app.ts:160-161` installs `watchLifecycle`; on Linux the first `take()` throws, and
  `src/app-watch.ts:138-160` reports it once on the `error` channel and stops polling.

**Reached:** a page registers `app.on("before-quit" | "will-quit" | "activate" | "reopen")` on Linux.
None of those events ever arrives; only an `error` is published. `window-all-closed` still arrives
through `watchWindows` polling (`platform.windowLabels()`), so the window subsystem itself is alive —
it is the focus/quit/delete event stream that is absent. Documented as an honest gap rather than a
fake listener, but from the page's side the four events "never arrive."

---

## F4 (low) — geometry and flag setters report `ok:true` when the request was only issued, never applied

- `src/platform/linux/window-state-adapter.ts:28-57` — `setSize`, `setPosition`, `setAlwaysOnTop`,
  `setFullscreen`, `minimize`, `unminimize`, `maximize` call `gate` on the write only. No readback,
  unlike `setTitle` (`window-adapter.ts:91-100`) and `setDecorations`/`setOpacity`
  (`window-chrome-adapter.ts:26-48`), whose comments state the principle ("a command that reports
  what it asked for instead of what the window shows is the one that makes a caller trust a no-op").
- `src/platform/linux/shim/45_window_api.c:93-103,113-117`, `46_window_state_api.c:23-27,51-71` —
  each shim returns 1 as soon as it issued the GTK request (`gtk_window_resize`, `gtk_window_move`,
  `gtk_window_fullscreen`, `gtk_window_iconify`, …), not when the WM applied it.

**Reached:** a window manager that ignores a placement or state request (tiling WMs and Wayland
especially) → the page gets `{ok:true}` from `window.setFullscreen`/`setPosition`/`maximize` even
though nothing changed. The confirmation that the state was reached never arrives; only a later
`isFullscreen`/`isMaximized`/`getPosition` read reveals the truth. The design permits this by
offloading verification to the caller, but the immediate success answer is misleading.

---

## F5 (low) — a missing GTK symbol is reported as a Wayland placement refusal

- `src/platform/linux/window-state-adapter.ts:32-35,36-39` — `setPosition`/`getPosition` branch on
  `sends.placeable()`, and on false call `refuse(..., "is not available on this display — GTK can
  only place a toplevel on X11…")`.
- `src/platform/linux/window-sends.ts:70` — `placeable()` is `shim_window_placeable() === 1`, which
  folds two different causes into one boolean.
- `src/platform/linux/shim/46_window_state_api.c:14-21` — `shim_window_placeable()` returns 0 both
  when the display is not X11 **and** when `shim_window_api_ready()` is 0 (a required entry point did
  not resolve).

**Reached:** a GTK3 old enough to lack one of the resolved window symbols. `setPosition` reports a
Wayland limitation ("not available on this display") instead of `unknown-adapter` naming the missing
entry point — the real reason for the refusal never reaches the page. `refusalGate`'s
`missing()` detail at `window-sends.ts:101-113` is never consulted on this path.
