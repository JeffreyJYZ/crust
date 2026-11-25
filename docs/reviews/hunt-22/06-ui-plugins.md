# Hunt 22 — window, tray and menu plugins

Read-only hunt. No `src/**`, `site/**` or test file was changed. Searches used `rg`, never `grep`.
No GUI app was launched, no window was opened, no cursor or physical input was touched, no real
status item was created. Two throwaway probes under the approved opencode temp dir exercised pure
functions and the Windows adapter's fake shim; neither touched a real tray, token or window. Every
finding below is from source and the existing test files; where a runtime proof would need the
human's screen, the finding says so instead of claiming one.

**Verdict: six findings. Two are medium — a Windows tray delimiter mismatch that routes clicks to
the wrong row, and a macOS cursor-visibility setter that is a counter dressed as a flag. Two are
low-medium, two are low. The existing suites would not catch any of them.**

## Findings, worst first

### F1 — Medium — Windows `tray.setMenu` accepts `\n` inside a label; C splits it into extra rows, so clicks shift onto the wrong handler

`src/platform/windows/tray-adapter.ts:87-101` checks only `next.length > TRAY_MAX_ITEMS`, then joins
labels with `"\n"`. There is no check for a newline inside a label. The Windows C unit splits on that
byte and ignores the `count` argument for parsing:

- `src/platform/windows/shim/62_tray.c:74-91` walks `joined` until `\n`, stores one label per segment,
  sets `g_label_count = index`. A label `"a\nb"` becomes two native rows.
- `src/platform/windows/shim/62_tray.c:64-70` assigns menu IDs `1..g_label_count` and records
  `g_click = chosen - 1`.
- `src/platform/windows/tray-adapter.ts:125-136` maps that index into its own `items` array, which
  still has one row.

So a click on the phantom row is dropped, and every real row after the newline answers an index one
too high — firing the next row's `onClick` and pushing `tray:click` with the next row's label. A
page that puts a newline in a tray label (a two-line title is a natural thing to try) gets a menu
whose items do not do what they say.

The Linux half has exactly the guard Windows lacks: `src/platform/linux/tray-adapter.ts:94-101`
refuses a label containing `\n` with `invalid-menu` before the join, and
`src/platform/linux/tray-adapter.test.ts:86-97` proves it. The guard was added in `e33c5fa`
("win32/linux native defects … tray delimiter") to Linux only; Windows kept the same `\n` transport
and no guard. `src/platform/windows/tray-adapter.test.ts:84-95` tests the row-count cap, not the
delimiter, so the suite is green.

Proof status: a throwaway probe drove `windowsTrayAdapter` with a fake shim and two rows,
`{ label: "a\nb" }, { label: "c" }`. The adapter accepted them and sent
`menu:2:a\nb\nc` — `count: 2` but three `\n`-separated segments, which `62_tray.c:80-90` parses into
three native rows. Not driven through real Win32 — there is no Windows tray on this macOS host.
Reachability: every `invoke("tray", "setMenu", …)` whose `items` contain a newline in a label, on a
Windows build.

Smallest fix: copy the Linux `findIndex((item) => item.label.includes("\n"))` guard into
`windowsTrayAdapter.setMenu` and add the matching test beside the row-count test.

### F2 — Medium — macOS `setCursorVisible` is a hide/unhide counter exposed as a boolean setter, so a repeated value desynchronises the pointer

`src/plugins/window-chrome.ts:127-135` answers `{ ok: true, visible: flag.value }` after one adapter
call, and `src/platform/darwin/window-chrome-adapter.ts:66-67` sends `cursorVisible(visible)` once per
request. The real send is a single C call (`src/platform/darwin/window-chrome.ts:55-57`) to
`shim_cursor_visible`, and its own comment states the rule it violates:
`src/platform/darwin/shim/100_window_chrome.c:23-31` — "`+hide` is a counter, not a flag: two hides
need two unhides before the pointer is back, so the caller sends exactly one of the pair per
request". The caller keeps no count.

Consequence: `setCursorVisible(false)` twice increments AppKit's hide count to 2; one
`setCursorVisible(true)` decrements it to 1 and the pointer stays hidden. `setCursorVisible(true)`
on an already-visible pointer calls `unhide` needlessly. The documented verb is a setter —
`site/app/docs/reference/api-window/page.mdx:35-36` lists `{ value }` → `{ ok: true, visible }` — so
a page is entitled to call it twice with the same value and expect the second to be a no-op.

Both test layers hide the bug: `src/plugins/window-chrome.test.ts:86-101` uses a fake that stores a
flag, and `src/platform/darwin/window-chrome.test.ts:152-159` uses a send double that only records
calls. Windows does it correctly — `src/platform/windows/window-cursor-adapter.ts:54-64` drives
`ShowCursor`'s count to the requested side and verifies the sign, so a repeat is idempotent.

Proof status: static from C, adapter and plugin; a live proof would hide the human's cursor, which
the brief forbids. Reachability: any page holding `window:setCursorVisible` that calls the command
more than once with the same value.

Smallest fix: track the requested visibility in the darwin adapter and only send on a transition
(the same guard `windowStateAdapter.setFullscreen` uses at
`src/platform/darwin/window-state-adapter.ts:36-39`), or drive the counter to a known side the way
the Windows shim does.

### F3 — Medium-low — `window.create` strips a page-supplied `token=` only literally; an encoded key shadows the live token and the new window loads a 401 page

`src/plugins/window-create.ts:59-75` treats an absolute URL at the bridge origin as app-owned,
strips `window=` pairs with `withoutWindowLabel`, and appends the bridge seed token with `withToken`.
`src/bridge/window-identity.ts:154-158` removes an existing token by testing
`pair.startsWith(`${TOKEN_PARAM}=`)` — a literal byte comparison. But the reader is
`tokenFromSearch` (`window-identity.ts:131-137`), which uses `URLSearchParams.get("token")`: keys are
decoded and the **first** value wins. The document route gates on that first value at
`src/bridge/server/handler.ts:76-82`.

A bridge-owned URL carrying `%74oken=dead` keeps that pair, then gains `&token=live` at the end.
`tokenFromSearch` returns `dead`, `state.labels.has("dead")` is false, and the new window's document
answers `401` instead of the app page. The URL-composition tests cover an encoded `window=` key
(`src/plugins/window-create-token.test.ts:71-79`) but not an encoded `token=` key.

Proof status: a throwaway probe called `withToken("/child?%74oken=dead", "live")` and got
`/child?%74oken=dead&token=live`; `tokenFromSearch` on that search returned `dead`, not `live`.
No window was opened. Reachability: `invoke("window", "create", { label, url: location.origin + "/child?%74oken=dead" })`
from a page holding `window:create`; also any app-configured absolute URL with an encoded stale token.

Smallest fix: make the token filter decode each key exactly as `withoutWindowPairs` does in
`src/bridge/window-query.ts:29-42`, and add the encoded-key case to `window-create-token.test.ts`.

### F4 — Low-medium — explicit `window-state.restore` skips the gone-monitor check the automatic path applies, so it can reopen a window nobody can see

The automatic dev path validates a saved frame against the live work areas before applying it:
`src/plugins/window-frame-memory.ts:137-147` calls `restorableFrame`, whose rule is at
`src/plugins/window-frame.ts:53-60`. The explicit command does not: `src/plugins/window-persist.ts:147-164`
reads `state[label]` and calls `calls.apply(label, frame)` directly. `workAreas` is supplied in every
runtime (`src/runtime-plugins.ts:169-174`), but the automatic half is armed only when the dev runner
lent a directory (`window-persist.ts:125-131`), so a built app has only the unchecked explicit path.

A frame saved while an external monitor was attached, then restored after that monitor is unplugged,
places the window entirely off every current work area — the exact case the visibility rule exists
to prevent. The guide's own framing of `window-state` is that it keeps a window findable.

Proof status: static. Not executed because restoring a frame moves a real window.
Reachability: `invoke("window-state", "restore", { label })` in a built app whose saved frame came
from a display that is no longer present.

Smallest fix: run `restorableFrame(frame, options.workAreas?.() ?? [])` in the `restore` command and
answer `{ restored: false }` when it fails, matching `restorable()`.

### F5 — Low — `cbuf` caches every distinct string for the process lifetime, so repeated window/tray/menu calls grow memory without bound

`src/platform/darwin/status-bar-args.ts:9-21` keeps both a `Set<Uint8Array>` of every encoded buffer
and a `Map<string, …>` keyed by the exact string, and neither is ever pruned. Every page-supplied
label that crosses darwin FFI goes through it: `tray.setTitle` / `tray.setTooltip`
(`src/platform/darwin/status-bar-item.ts:85-86,104-105`), `tray.setMenu` labels
(`status-bar-item.ts:128`), `menu.setAppMenu` labels and accelerators
(`src/platform/darwin/menu-api.ts:50-51`), and menu readback titles (`menu-readback.ts:39`). The calls
are synchronous, so a buffer only needs to live for the duration of one send; retaining it forever
buys nothing except a cache for exact repeats.

A page holding those capabilities can grow the process heap monotonically by sending unique strings,
and a long-running app that rebuilds its menu repeatedly accumulates every version.

Proof status: static from the cache and its callers; no heap measurement was taken, so the size is
not quantified. Reachability: repeated `tray.*` or `menu.*` calls with distinct strings on macOS.

Smallest fix: keep the buffer alive only across the FFI call (allocate per call, or an LRU with a
small bound) rather than in two process-lifetime collections.

### F6 — Low — `window.setTitle` reports a bad title with the `invalid-label` code, so a page cannot distinguish "no label" from "bad title"

`src/plugins/window.ts:103-111` validates the `title` string and returns
`code: "invalid-label"` with a message about needing `{ label, title }`. `WindowErrorCode`
(`src/plugins/window-types.ts:63-72`) has `invalid-url`, `invalid-size` and `invalid-value` but no
title-specific code, and the API reference documents `invalid-label` as "a missing or empty
`label`, or a `create` title that is not a string" (`site/app/docs/reference/api-window/page.mdx:43`)
— not a bad `setTitle` title. A page that branches on `invalid-label` to fix its label will loop on a
title bug it cannot name. The sibling validation in `parseCreate` uses the same code only for the
`create` title, so the collision is documented there but not here.

Proof status: static. Reachability: `invoke("window", "setTitle", { label: "main", title: 42 })`.

Smallest fix: add `invalid-title` to `WindowErrorCode` and use it in `window.setTitle`.

## Non-findings worth stating

- The `menu` plugin's single `sink` is deliberately the last command's context
  (`src/plugins/menu.ts:81-87,135,146`; test at `src/plugins/menu.test.ts:145-162`). `PluginContext.emit`
  broadcasts to every connected page (`src/plugins/define.ts:11-23`), so a stale sink is not a
  cross-window data leak. Not reported.
- `window.label` answering the routing hint rather than an authority label is intentional and
  documented in `src/plugins/window-label.ts:10-18`. Not reported.
- `window.capture` answering `not-implemented` on Windows and Linux is the named design
  (`src/plugins/window-capture.ts:3-8`), not a silent fake. Not reported.
- `menu.read` walks one submenu level only; the C readback says so at
  `src/platform/darwin/shim/98_menu_read.c:6`. Not reported.
