# Linux platform — read-only defect hunt

Scope: `src/platform/linux/**` (84 files, 9,309 lines). No source files changed.
Tree at review: `2174a6d` (`docs(install): re-measure the tag for 0.2.18`), clean worktree.

Caveat carried through every C finding: the shim is compiled here but has never run against a real
GTK/WebKitGTK display server on this machine, so C findings are static analysis of the shipped source
and the call order, not a reproduced runtime failure. JS findings are checkable from source alone.

## Findings

### 1. MEDIUM — preflight omits three symbols `shim_lib_open` requires

`src/platform/linux/preflight.ts:33-66`, `src/platform/linux/shim/41_container.c:44-60`,
`src/platform/linux/shim/10_prelude.c:127-134`, `src/platform/linux/preflight.test.ts:32-57`

`PREFLIGHT` lists 25 entries. `shim_container_resolve()` resolves eleven symbols with mandatory
`shim_sym`, and three of them are absent from that list and from the test's "covers every symbol the
shim requires" list:

```
41_container.c:47  shim_sym(h, "gtk_fixed_new", ...)
41_container.c:55  shim_sym(h, "gtk_widget_set_hexpand", ...)
41_container.c:56  shim_sym(h, "gtk_widget_set_vexpand", ...)
```

`shim_lib_open()` calls `shim_container_resolve()` and treats a failure as a fatal load error, so a
GTK that exports the 25 probed symbols but lacks any one of these three passes the launch preflight
and then fails inside `shim_lib_open()` with the generic `missing symbol <name>` text. The whole point
of the expanded `PREFLIGHT` table (and its test's comment at `:29-31`) is that this cannot happen.

Breaks: the launch check and the library check disagree about what "preflight passed" means; the
actionable install message is replaced by a bare symbol name. Reach: every Linux launch on a GTK
older than the one this was measured against. The test cannot catch the gap because it hardcodes the
same incomplete list rather than deriving it from the C.

### 2. MEDIUM — a 33rd simultaneous window is shown but untracked

`src/platform/linux/shim/40_window.c:96-108`, `src/platform/linux/shim/40_window.c:72-78`,
`src/platform/linux/platform.ts:98-106`, `src/platform/linux/platform.ts:113-120`,
`src/app-watch.ts:83-95`

`shim_window_new()` returns the `GtkWindow *` it just built even when no slot was available:

```c
if (slot < 0 && shim_slot_count < 32) slot = shim_slot_count++;
if (slot >= 0) { shim_slots[slot].win = win; shim_slots[slot].alive = 1; }
return win;
```

With 32 live windows, `slot` stays `-1` but a non-null pointer is returned. `backend.createWindow()`
(`:123-146`) therefore succeeds and `LinuxPlatform.createWindow()` (`:86-95`) records the label.
`shim_window_alive()` finds no slot for that pointer and answers 0, so `backend.isOpen()` is false and
`window()` / `windowLabels()` prune the label at the next read. `watchWindows()` uses
`platform.windowLabels()` as the live set, so `window-all-closed` can fire and quit the app while the
33rd window is still on screen.

The header comment at `:35-37` claims slot reuse makes 32 a ceiling on *simultaneous* windows and
that "opening and closing more than 32 over a process lifetime cannot leave a live window untracked".
The first half is false: the cap is enforced on the table, not on window creation.

### 3. MEDIUM — browser-surface policies are connected after the first load starts

`src/platform/linux/browser.ts:91-114`, `src/platform/linux/shim/30_webview.c:100-109`

`open()` loads the view at `:100` (`p.load(web, input.url)`) and only afterwards, at `:108`, connects
the three policy handlers (`watch`, `denyCapture`, `watchNav`). The app's own view connects its
signals at creation for exactly this reason:

```c
// Connected at creation, because a load starts the moment the window loads and
// a handler attached afterwards would miss its own first event.
```

The surface's `create` and `permission-request` handlers have no equivalent of `firstLoadAware()`
(the JS workaround exists only for the `decide-policy` gate at `:115-117`). A page that calls
`window.open()` or requests capture during its initial load does so before the refusal handlers are
installed. In C the sink is installed even later still: `channel()` at `browser.ts:114` is what calls
`shim_browser_set_sink` / `shim_browser_set_decision_sink`, so a signal emitted between `:108` and
`:114` runs with no sink and `shim_browser_decide()` defaults to `allowed = 1`.

Breaks: the "every new window is refused" and "every permission request is denied" promises in
`31_browser.c:1-10` are not in force for the first document. Reach: any surface whose initial HTML
asks for a popup, camera, microphone or geolocation synchronously.

### 4. MEDIUM — predictable, unverified temp C path is compiled into the process

`src/platform/linux/shim-ffi.ts:161-169`, `src/platform/linux/notify-tray-ffi.ts:107-111`

```ts
const hash = createHash("sha256").update(shimSource).digest("hex").slice(0, 16);
const path = join(tmpdir(), `crust-linux-shim-${hash}.c`);
if (!existsSync(path)) writeFileSync(path, shimSource);
```

On Linux `tmpdir()` is `/tmp`, world-writable with the sticky bit. The filename is a hash of the
shipped shim source, which is public, so any local user can pre-create that exact path (a regular
file or a symlink) before the victim launches. `existsSync` follows symlinks, so the check passes and
`cc()` compiles the attacker's C into the victim's process, with the assumed names of the shim
symbols. The notify/tray unit has the identical pattern.

Breaks: local code execution in the app process, and a stale or truncated file from an interrupted
previous write is reused forever because the bytes are never compared with `shimSource`. A companion
race exists when two processes launch simultaneously: both see the path absent and write it at once.
No claim is made about a remote attack; this needs local access to the same `/tmp`.

### 5. LOW — `shim_webview_place` skips its resize calls in production

`src/platform/linux/shim/42_host.c:57-82`, `src/platform/linux/shim/41_container.c:65-88`
`src/platform/linux/shim/41_container.c:92,109,119`

`shim_webview_place()` ends with two calls guarded by `shim_queue_resize`:

```c
if (shim_queue_resize) shim_queue_resize(host);
if (shim_queue_resize) shim_queue_resize(box);
```

`shim_queue_resize` is resolved only inside `shim_container_resolve_reads()`, which is called from
the three proof readbacks (`shim_webview_layout`, `shim_webview_requested`,
`shim_webview_allocated`). The place path itself never calls it. An app that opens a surface and
calls `browser.setBounds` without ever driving one of those proof readbacks leaves the pointer null,
so neither resize call runs.

Mitigation, stated honestly: GTK3's `gtk_widget_set_size_request` and `gtk_widget_set_margin_start`
normally queue a resize themselves, so the missing calls may be redundant in practice. The defect is
that a call the author clearly intended to make is silently absent on the normal, non-proof path,
and the two paths behave differently for no stated reason.

### 6. LOW — a failed `createWindow` leaves a GTK window behind

`src/platform/linux/backend.ts:115-147`

`shim_window_new()` succeeds at `:125` and registers a slot. Every later step can throw:
`shim_webview_new` null (`:135-136`), `shim_window_container` null (`:139-140`), attach refused
(`:141-142`), load refused (`:143-144`). None of those paths calls `shim_window_destroy(win)`, and
`LinuxPlatform.createWindow()` records the label only after `createWindow` returns, so the platform
cannot clean it up either. The window is not shown yet (`shim_window_show` is the last step at
`:145`), so this is an allocation and slot leak rather than a visible stray window. Reach: a WebKit
that creates views unreliably, or a bad URL passed to `shim_webview_load`.

### 7. LOW — surface state records are not released when their host window is destroyed

`src/platform/linux/shim/40_window.c:60-70`, `src/platform/linux/shim/42_host.c:13-29`,
`src/platform/linux/shim/32_view_state.c:41-62`

`shim_on_destroy()` forgets only the app's own view, held in `shim_window_web[i]` by
`shim_window_attach()`. Embedded surface views live in `shim_host_view[]` and their load/eval records
in `shim_view_states[]`; both are released only by `shim_webview_close()`, which runs from
`browser.close`. `src/plugins/browser.ts` has no window-close hook that calls `close`, so closing a
host window while a surface is open leaves a host slot and a view-state slot occupied. After 32 such
closes, `shim_host_for()` and `shim_view_state_for()` find no free slot and refuse new surfaces; a
new view at a reused address can also read a stale record.

### 8. LOW — dead ternary in the browser decision sink

`src/platform/linux/browser.ts:59`

```ts
urlOf: (kind) => (kind === 0 ? port().popupUrl() : port().popupUrl()),
```

Both arms are identical. The code happens to work because `31_browser.c:75` writes the decision's
URI into the same `shim_browser_popup` buffer that popup reporting uses, so `popupUrl()` returns the
right value for both kinds. The ternary is nevertheless misleading: it reads as if popups and
navigations have separate sources when they share one global buffer, which also means a refused
popup's URL is lost if a navigation commits before JavaScript reads it.

## Coverage

Read in full: `index.ts`, `active-platform.ts`, `platform.ts`, `backend.ts`, `shim-ffi.ts`,
`shim-symbols.ts`, `shim-browser.ts`, `dialog-ffi.ts`, `snapshot-ffi.ts`, `cstring.ts`,
`preflight.ts`, `shim-source.ts`, `notify-tray-source.ts`, `notify-tray-ffi.ts`, `clipboard.ts`,
`opener.ts`, `os-info.ts`, `keychain.ts`, `dialog.ts`, `snapshot.ts`, `screen.ts`, `browser.ts`,
`browser-navigation.ts`, `browser-ports.ts`, `window-adapter.ts`, `window-chrome-adapter.ts`,
`window-sends.ts`, `window-state-adapter.ts`, `tray-adapter.ts`, `tray-tick.ts`,
`notification-adapter.ts`, all 19 C shim parts, and `preflight.test.ts` / `shim-source.test.ts` /
`src/plugins/keychain.ts` / `src/app-watch.ts` where a claim needed checking.

Checked and found correct, not reported: `preflight` now runs on the real launch path
(`backend.ts:86`), fixing the earlier "dead probe" finding. Window slots are reused after destroy.
`shim_lib_open` closes both handles on a failed resolve. `shim_state_eval_done` frees both the
`GError` and a co-returned `JSCValue` with GLib's own free, and `g_free` is used everywhere a GLib
string crosses back. The load state machine's sticky-failure rule for `load-failed` followed by
`FINISHED` is present at `32_view_state.c:88-97`. The snapshot generation check prevents a late
callback from answering a later capture. `keychain` NUL validation is enforced in the plugin
(`src/plugins/keychain.ts:67-70,129-132`) before the Linux adapter sees a name.

Not examined: the test-only fakes (`window-fake.ts`, `backend-shim-fake.ts`, `*-fake.ts`), the other
platform trees, and `scripts/linux-smoke.ts` / the doctor's Linux window check.
