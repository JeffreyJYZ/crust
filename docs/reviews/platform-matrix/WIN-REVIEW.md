# Review — `47415e1`, the Windows window adapter

Scope: the committed diff only (`git show 47415e1`), never the working tree. Everything below is
read-from-code or a test I ran on macOS; nothing was observed on Windows. The one Windows-behaviour
claim is marked where it appears.

The wiring is right, and the part the brief was most suspicious of is clean: **`setSize` does not
drift.** `frameOf` reads all four components and `setFrame` writes all four back
(`window-state-adapter.ts:35-51`, `:65-76`), so a resize re-sends the window's own origin instead of
letting `SetWindowPos` default it, and the test pins the arguments (`set_frame:40,60,800,600`). The
same for `setPosition` (`set_frame:10,20,900,640`). The ABI half is also covered properly — see
"Checked hardest".

## Findings, worst first

### 1. `unminimize` un-maximises a maximised window — silent state loss

`window-state-adapter.ts:82` maps `unminimize` to verb `2`, and `shim/40_window.c:79` maps verb `2`
to `SHIM_SW_RESTORE` (9). `SW_RESTORE`'s documented job is "if the window is minimized **or
maximized**, the system restores it to its original size and position", so on a maximised window it
is a *demote*, not a no-op. Darwin's equivalent is `deminiaturize` (`darwin/window-state-adapter.ts`),
which does nothing to a zoomed window — so this is both a state loss and a cross-platform divergence.

Reachable: `await window.maximize({ label })` then `await window.unminimize({ label })` from any
page. Both answer `{ ok: true }`, `window.isMaximized` then reads `false`, and the window has quietly
lost its size. A blind `unminimize()` after a "the window may be minimised" check is the common shape
that hits it.

Smallest fix: in `shim_window_show`, make verb 2 conditional —
`if (verb == 2 && !IsIconic(hwnd)) return 1;` before the `ShowWindow` call, so restore is only sent
to a window that is actually minimised.

### 2. Nothing guards the frame of a minimised or maximised window

`frameOf` (`window-state-adapter.ts:35-40`) reads `GetWindowRect` unconditionally, and `setSize`
(`:65-68`) writes it back unconditionally. Win32 does not promise a useful frame in either state:
a minimised window sits at the iconic off-screen position (classically `-32000, -32000`), and a
maximised one reports the maximised rect while ignoring a subsequent `SetWindowPos` resize. Neither
claim is observed here — it is the documented Win32 behaviour, unverified on this machine — but the
code has no guard either way, so both states are read and written as if they were the normal frame.

Reachable: `window-state.saveAll()` (or `save`) fired while the window is minimised — the ordinary
"save on quit" path, with the user having minimised first — persists `x:-32000, y:-32000` and a
minimised height into `window-state.json`; the next `restore` puts the window back off-screen where
nobody can find it. In the maximised case `setSize` answers `{ ok: true, width, height }` and the
window keeps its maximised size, so `getSize` immediately afterwards disagrees with the answer.

Smallest fix: in `frameOf`, refuse when `shim_window_is_minimized(hwnd) === 1`
(`handler-error`, "the window is minimised, so its frame is not its restored frame") — a `save` then
reports a typed failure instead of persisting an off-screen frame. The correct long fix is one more
binding, `GetWindowPlacement`, whose `rcNormalPosition` *is* the restored rect. For the maximised
half, `setSize`/`setPosition` should send `SW_RESTORE` first when `IsZoomed` is 1, or refuse.

### 3. `getSize` answers `0×0` for a window that has just closed

`shim_window_frame_num` (`shim/40_window.c:57-71`) returns `0` both for "`GetWindowRect` failed" and
for a legitimate `0` coordinate, and `frameOf` (`window-state-adapter.ts:35-40`) has no way to tell
them apart. A failed read therefore yields `{ x: 0, y: 0, width: 0, height: 0 }` and `getSize`
answers `{ ok: true, width: 0, height: 0 }`.

Reachable: the user closes the window between `require(label)`'s `IsWindow` prune and the four
`GetWindowRect` calls — the registry pruned on read, so the label was live a moment earlier. The
window is gone and the command reports success with a zero frame instead of `unknown-window`. The
same torn read makes `setSize` compute an origin of `0,0`, which only fails because `SetWindowPos` on
a dead handle returns 0.

Smallest fix: `if (width <= 0 || height <= 0) throw new WindowAdapterError("handler-error", …)` in
`frameOf` — a zero-width window cannot exist, so that is a reliable failure signal and needs no new
binding.

### 4. `window-state` persists to a file shared by every crust app on the machine

`runtime-plugins-other.ts:66` builds `createWindowStatePlugin({ native })` with no `app` and no
`root`, so `window-persist.ts:97` falls back to `defaultStateRoot("crust")`. Every crust app on that
machine writes the same `window-state.json`, and on Windows `defaultStateRoot` builds a macOS-shaped
path (`~/Library/Application Support/crust`) rather than an `AppData` one.

Reachable: two crust apps installed side by side; the second one's `restore` reads the first one's
frames and moves its own window to the other app's size and position. This is pre-existing on darwin
(`runtime-plugins.ts` passes `{ native: windowAdapter }` too), but before this commit the Windows
plugin refused every command, so the commit is what makes the shared file live on Windows.

Smallest fix: thread `app: appId` through `OtherPlatformParts` and pass
`createWindowStatePlugin({ native, app: appId })` — one field and one argument, since `nativePlugins`
already holds `appId` and gives it to `store` and `database`.

### 5. `setAlwaysOnTop`/`isAlwaysOnTop` is refused on a false reason

The file header (`window-adapter.ts:12-14`) says always-on-top needs "`GWL_EXSTYLE` for always-on-top
… a read-back Win32 does not give the shim in one call". Win32 does give it, and the hard half is
already bound in this very commit: the *set* is
`SetWindowPos(hwnd, HWND_TOPMOST | HWND_NOTOPMOST, 0,0,0,0, SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE)` —
`SetWindowPos` is new here — and the *read* is `GetWindowLongW(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST`,
one 32-bit `int` binding (the width the brief warns about; declared `int`, not `shim_i64`).

Reachable: any page that wants a floating palette calls `window.setAlwaysOnTop({ label, value: true })`
and gets `unknown-adapter`, on the one platform where the concept is two calls away. Of the six
refused pairs this is the cheapest to close and the most commonly used.

Smallest fix: bind `GetWindowLongW` as `int`, add `shim_window_set_topmost(hwnd, on)` reusing the
already-bound `SetWindowPos` with `SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE`, and implement both members.

The other five refusals stand up better. `setOpacity`/`opacity` has the same overstated justification
(`GetLayeredWindowAttributes` is a read-back, so only the `WS_EX_LAYERED` conversion is real work),
but layered windows plus a WebView2 child is a genuine risk and not a shortcut. `setFullscreen`,
`setDecorations` and `setCursor`/`setCursorVisible` each need style save/restore, monitor geometry or a
thread-wide `ShowCursor` refcount, and `positioner`'s refusal is correct: its placements are AppKit
bottom-left geometry, and wiring it to a y-down adapter would put `topLeft` at the bottom edge.

### 6. The OS arm is correct but unproven in this commit

`runtime-plugins-other.ts:36-47` is right — `ADAPTED` names exactly `"window-state"`, which is the
bare plugin's real name (`window-persist.ts:147`), `nonDarwinPlugins` carries no `window` entry, and
the filter is `os === "win32"`-scoped so the linux arm keeps its bare `window-state`. I ran the
composition for both arms and it produces no duplicate name and nothing missing. But **no test in
`47415e1` covers it**: the only proof I could execute is `src/runtime-plugins-windows.test.ts`, which
is untracked at HEAD (another lane's file). A mistake here is a startup crash — the registry refuses a
duplicate name rather than shadowing — and a future edit to `nonDarwinPlugins` can break Windows with
every existing test green.

Smallest fix: commit the composition test (the untracked file already asserts uniqueness for `win32`
and the bare refusal for `linux`).

### 7. The active-platform singleton is set but never cleared

`platform-factory.ts:15` registers the platform, `active-platform.ts:16` holds it, and nothing clears
it — not `quit()`, not a failed `start()`. `createPlatform` therefore silently repoints the registry's
adapter at a second platform while the first one's windows are still open, and `close`
(`window-adapter.ts:105-107`) resolves the singleton twice, so a change between `require(label)` and
`destroy(label)` would check one platform's handle and destroy another's.

Reachable: any second `createPlatform` in one process — a test that builds a platform without
teardown, or a host that embeds the platform and then calls `app.run()`. In production `app.run()` is
the only caller and `App.attach` refuses a second app, so this is a test-suite hazard rather than a
user-visible one, which is why it is last.

Smallest fix: clear it in the platform's own teardown (`setActiveWindowsPlatform(undefined)` in
`quit()`), or refuse a second `createPlatform` while one is active.

### 8. The fake shim restates the two mappings no test can reach

The adapter tests are better than most: they pin `set_frame:40,60,800,600`, the `show:` verbs, and
`webview_new:`'s URL, so argument order is genuinely proven. The gap is the C side. The fake's
`shim_window_frame_num` mirrors the shim's own component order (`0 x, 1 y, 2 width, 3 height`) and the
adapter's verb numbers (`0 minimize, 1 maximize, 2 restore`) are pinned, but the C mapping from verb
to `SW_*` and from component to `rect[i]` is asserted by nothing — `ffi-abi.test.ts` checks arity and
widths, not constants. Swapping `SHIM_SW_MINIMIZE` and `SHIM_SW_MAXIMIZE` at `shim/40_window.c:79`
leaves every test green.

Reachable: the two constants are one transposition apart and the only new logic in C. Smallest fix:
have the shim expose its three `SW_*` values (or a `shim_window_show_constants` returning them) and
assert them in `window-adapter.test.ts`, the way `abi-width.test.ts` pins widths.

## Checked hardest

- **Frame drift on `setSize`** (the brief's first suspicion): clean. All four components are read and
  written back, and the test pins the literal arguments, so a `SWP_NOMOVE`-less `SetWindowPos` with a
  defaulted origin is excluded by evidence rather than by inspection.
- **ABI widths and arity**: clean and exhaustive. `abi-width.test.ts` gained the five new user32
  entries in `THIRTY_TWO`, and its last test cross-checks the prelude's declared pointers against the
  four tables in *both* directions, so an unclassified entry point fails. `ffi-abi.test.ts` parses
  every `bun:ffi` declaration and compares it with the C prototype for argument count and for return
  and argument widths, automatically — the six new `shim_window_*` functions are covered without
  being named. I ran all three suites: 26 pass, 0 fail.
- **The `window-state` arm**: clean. `ADAPTED` matches the plugin's real name, the linux arm keeps the
  bare plugin, and the composed name set has no duplicate for either OS (run, not read).

No finding here is a fault or a crash; the worst are one lost maximised state and one possible
off-screen restore. Nothing in the commit invents a capability it cannot answer, which is the failure
mode the refusals exist to avoid.
