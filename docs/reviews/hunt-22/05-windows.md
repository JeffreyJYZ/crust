# Hunt 22 — Windows platform and Win32 paths

Scope: every file under `src/platform/windows` (TS adapters, the assembled C shims, and the tests read
for coverage). All claims are `read` unless marked `measured`. No Windows, user32, COM or WebView2 was
available here; no GUI was touched and no repository file was changed except this report. Two local
`bun` probes are marked `measured` below: one for `bun:ffi` pointer arguments, one for repeated `cc()`
calls. No High finding. Prior hunt-20/21 Windows findings re-checked below are listed as fixed or
carried over only where they are still open.

## Medium — `screen.list()` compiles and loads a fresh copy of the entire shim on every call

- where: `src/platform/windows/screen.ts:55-71`; `src/platform/windows/backend-default.ts:68`;
  `src/platform/windows/ffi.ts:80-145`; callers `src/platform/windows/window-positioner.ts:35-38` and
  `src/runtime-plugins-other.ts:148-158`.
- mechanism: `windowsScreenAdapter`'s default injector is `() => defaultBackend().load()`, and
  `defaultBackend().load` is `compile` (`ffi.ts`), whose body calls `cc()` and returns a new symbol
  table. Nothing caches that table and nothing calls the returned library's `close()`. `measured`
  here on Bun 1.4.5 with the same `cc()` API: two `cc()` calls on one source file returned different
  symbol-table objects, different function objects, and each library exposes a `close`. So each
  `screen.list()` recompiles the whole 4.8k-line C unit, re-resolves every Win32 pointer in a new
  instance, and leaves a loaded library behind. Every adapter except `screen.ts` asks the running
  platform for its already-compiled shim (`active-shim.ts:12-14`); `screen.ts` is the outlier.
- reachable by: any `crust:screen.list()` on Windows, any `positioner.place()` (which reads
  `windowsScreenAdapter().list()` through `displaysNow()`), and window-frame restore, which calls
  `windowsWindowWorkAreas()` at startup and on subsequent restorations. Repeated polls grow the
  process with one compiled native library per call; the C unit's own statics (window, min-size and
  surface tables) are duplicated in each copy, so a caller can hold two disjoint views of "the
  app's" native state.
- smallest fix: default the injector to `activeWindowsShim() ?? once-compiled-shim`, the same cached
  shape `notify-tray-ffi.ts:123-128`, `pty-ffi.ts:137-142` and `keychain-ffi.ts:94-99` already use;
  inject the running platform's shim in `runtime-non-darwin.ts:77` and `runtime-plugins-other.ts`
  so the screen adapter never builds a second one. Add a test that counts `load()` calls across two
  `list()`s — `screen.test.ts` currently injects a shim in every test, so the default path is untested.

## Medium — tray menu labels are split on `\n` while the caller's `count` is ignored; a newline in a label shifts every later click

- where: `src/platform/windows/tray-adapter.ts:87-102`; `src/platform/windows/shim/62_tray.c:74-91`;
  `src/plugins/tray-args.ts:43-62`; `src/plugins/tray.ts:117-132`.
- mechanism: `readItems` accepts any non-empty string as a label — no newline restriction. The
  adapter flattens labels with `next.map(item => item.label).join("\n")` and passes `next.length` as
  the second argument. C `shim_tray_menu(joined, count)` never reads `count`: it walks the buffer
  until NUL, splitting on every `\n` into up to 12 rows. A label containing `\n` therefore produces
  more `g_labels` rows than the adapter's `items` array. `TrackPopupMenu` reports the visual row as
  `chosen` and `62_tray.c:69` stores `g_click = chosen - 1`; `tray-adapter.ts:125-136` indexes the
  original `items` with that number. Clicking the second visual row fires the handler the plugin
  wired to the *next* logical item, and `tray.ts:126` emits that item's index and label in the
  `tray:click` event. Clicks beyond `items.length` are silently dropped.
- reachable by: `crust:tray.setMenu({ items: [{ label: "Open\nDocs" }, { label: "Quit" }] })` — a
  valid request by the plugin's own validator. The human sees two rows, and clicking the first row's
  second line runs Quit's handler and reports `{ index: 1, label: "Quit" }`. Long labels are a
  sibling case: `62_tray.c:86` truncates past 95 bytes, so the row the human reads is not the full
  label the page passed, while `setMenu` still answers `{ ok: true, labels: [...] }` with the
  untruncated strings.
- smallest fix: reject `\n` (and UTF-8 labels over 95 bytes) at `readItems` for all platforms, or
  encode rows with a length-prefixed frame that C parses `count` times; make the adapter's answered
  labels the ones C actually stored. `tray-adapter.test.ts:67-92` only checks plain labels.

## Medium — every Win32 string truncates at an embedded NUL and still reports success

- where: `src/platform/windows/cstring.ts:9-11`; `src/platform/windows/shim/10_prelude.c:154-160`;
  `src/platform/windows/shim/60_notify_tray.c:139-145`; affected callers include
  `src/platform/windows/clipboard.ts:61-70`, `window-adapter.ts:127-135`, `opener.ts:41-52`,
  `tray-adapter.ts:82-100`, `preview.ts:141-158`.
- mechanism: `cstring()` appends one NUL to the JS string, and both `shim_utf16` implementations call
  `MultiByteToWideChar(65001, 0, src, -1, ...)` — source length `-1` means "stop at the first NUL".
  Text after an embedded `\0` never reaches Win32. The surrounding calls still succeed:
  `shim_clipboard_write` allocates and converts the prefix, `SetClipboardData` accepts it and returns
  1, and the adapter answers `written`; `SetWindowTextW` accepts the shortened title and answers 1,
  so `window.setTitle` answers success. `clipboard.ts:56-65` validates only `typeof text ===
  "string"`, so JSON can deliver the NUL. The same shape applies to window titles, tray tooltips and
  labels, dialog titles, opener paths/URLs and preview paths.
- reachable by: `crust:clipboard.write({ text: "secret\0hidden" })` on Windows. The clipboard holds
  `secret`, the caller gets `{ ok: true }`, and no error says the rest was dropped. This is a silent
  data loss, not a crash, so no test in `clipboard.test.ts` can see it through the fake shim.
- smallest fix: refuse a NUL at the adapter boundary (`clipboard.writeText`, `window.setTitle`,
  `tray.setTooltip`, `setMenu`, `opener`, `preview.show`) with a typed bad-request, or pass the
  explicit byte length through `cstring()` and use it in both `shim_utf16` implementations instead
  of `-1`. Prefer refusal: Win32 APIs cannot carry a NUL inside these fields anyway.

## Medium — the native navigation decision fails open when the web pointer is not in the surface store

- where: `src/platform/windows/browser-navigation.ts:77-84`; `src/platform/windows/browser.ts:87-116`;
  `src/platform/windows/shim/58_browser_events.c:77-93`.
- mechanism: `decideNavigation` returns `1` (commit allowed) when `parts.find(web)` yields no surface,
  before it ever reads `parts.urlOf` or the decision. C calls the one process-wide sink with the
  `sender` web pointer from `NavigationStarting` (`58_browser_events.c:92`) and with the refused-new-window
  pointer (`:74`), and the sink is installed once by `browser.ts:57-68`. But `open()` installs
  `watch`/`refusePopups` at lines 96-107 and only calls `decisions.set(...)` and `store.set(...)`
  at lines 109-116. A navigation that fires after the handlers are attached but before the store is
  populated — or a late event from the dying webview after `close()` removed the surface — has no
  matching entry and is allowed. The decision is the rule that refuses a foreign target; an
  unmatched web pointer bypasses it rather than refusing.
- reachable by: a fast redirect during surface setup, or a late `NavigationStarting` from a surface
  that was just closed. Both commit without consulting `onNavigate`, so a URL the app refused is
  loaded in a visible WebView2 surface. `browser-navigation.test.ts` exercises a known surface and a
  refusing decision, never an unknown web pointer.
- smallest fix: return `0` (cancel) when `find` misses, and record the pointer in `store` before the
  handlers are installed so the normal first load cannot be cancelled by the same change. For popups
  the safe answer is to not call `onPopup` and still keep the WebView2 "handled" state.

## Medium — a shim compile failure marks the platform started; a retry reports "start() has not run"

- where: `src/platform/windows/platform.ts:69-80,121-129`; `src/platform/windows/startup.ts:20-23`;
  `src/platform/windows/backend.ts:127`; `src/app.ts:149-154`.
- mechanism: `start()` sets `#started = true` on line 71 **before** calling `startWindows`.
  `backend.load()` is documented to throw when the C unit will not build, and `startWindows` calls it
  unguarded. The thrown error escapes `start()` (pinned by `platform.test.ts:66-70`) but leaves
  `#started === true` and `#shim === undefined`. A second `start()` returns immediately at line 70;
  `createWindow` then throws `"createWindow: start() has not run"`, which is false, and `unavailable`
  stays empty because the failure was a throw, not a reported message. Neither `app.run()` nor any
  caller retries, so the only repair is constructing a new platform.
- reachable by: a TinyCC failure on a machine whose shim source cannot compile (the exact case the
  backend comment names), followed by any attempt to recover in-process — for example fixing the
  environment and calling `start()` again. The second attempt silently does nothing and the real
  cause is lost.
- smallest fix: set `#started` only after `startWindows` returns, or set it in a `finally` together
  with a sticky `#startError` that `start()` rethrows and `createWindow` names. Add a test that a
  second `start()` after a throwing `load()` rethrows the same error rather than resolving.

## Low — preview failures at `initialize` lose their step, and `hwnd()` keeps a dead child after the parent closes

- where: `src/platform/windows/shim/54_preview.c:59-69,74-104,130-134`;
  `src/platform/windows/shim/53_preview_host.c:44-65`; `src/platform/windows/preview.ts:141-182`.
- mechanism: two separate gaps in the same host. (1) `shim_preview_show` clears `g_preview_step` and
  `g_preview_hresult` at entry, but the `!preview_initialize(handler)` branch at lines 93-98 returns
  `SHIM_PREVIEW_FAILED` without calling `preview_failed_at`; `previewDetail(shim)` therefore reports
  "the preview stopped at none" with no HRESULT for a real initialise failure. (2) The host is a
  `WS_CHILD` of the app window, so Windows destroys it with the parent, but `g_preview_host` is not
  cleared. `shim_preview_hwnd()` returns the stale number and `preview.ts:160` still accepts any
  `hwnd > 0` as proof of a shown preview; `shim_preview_size` does check `IsWindow` and refuses.
- reachable by: a handler that accepts the file but refuses `Initialize` — the caller gets a failure
  with a useless detail. Then close the app window by its title bar; `preview.hwnd()` returns a
  destroyed handle (possibly recycled by a later window) until `hide()` or a later `show()` calls
  `preview_clear()`.
- smallest fix: route the initialise failure through `preview_failed_at(SHIM_PREVIEW_STEP_INITIALIZE,
  hr)`; make `shim_preview_hwnd()` answer 0 when `!IsWindow(g_preview_host)` and clear the static in
  that case. Note this host is not reachable from `preview.show` today (`hunt-21/02`), so both are
  latent until the HWND is threaded through the surface request.

## Low — `os.info.uptime()` throws for a machine that has been awake under one second

- where: `src/platform/windows/os-info.ts:51-58`; `src/platform/windows/shim/52_osinfo.c:66-71`.
- mechanism: C divides `GetTickCount64()` by 1000 into a double, so the first 999 ms after boot are
  `0.0`. The adapter throws whenever `!(seconds > 0)`, conflating a legitimate zero with the
  shim's `0.0` refusal when the entry point was not bound.
- reachable by: a process that starts in the first second of an awake session (fast boot into a
  launch-at-login app, or a test that stubs the counter). `crust:os.info()` then answers
  `handler-error` instead of an uptime of zero.
- smallest fix: have C return a negative sentinel when the counter cannot be read; let the adapter
  accept `0` as a real value.

## Low — a `SE_ERR_*` refusal from `ShellExecuteW` never carries the number the header promises

- where: `src/platform/windows/shim/51_opener.c:6-9,45-60`;
  `src/platform/windows/opener.ts:7-10,31-35,54-64`.
- mechanism: the header says the code is "recorded as a reason" and the adapter says `reasonOf`
  returns "the reason the C half recorded, or a sentence naming the missing one". C writes one fixed
  string — "ShellExecuteW answered a SE_ERR_* code at or below 32, which is not an HRESULT" — with
  the actual `code` formatted nowhere. `openPath`/`openUrl`/`revealItem` refuse with that string and
  no error number, so the caller cannot tell file-not-found (2), access-denied (5) or no-association
  (31) apart.
- reachable by: any refused shell launch; this is exactly the diagnosis the comment claims to
  provide.
- smallest fix: format `code` into `g_opener_reason` with a bounded decimal writer (the buffer is
  256 bytes) and keep the no-HRESULT sentence around it.

## Checked and clean

- **`bun:ffi` pointer arguments accept typed arrays**: `measured` here with a compiled C function
  taking `FFIType.ptr` — a `Uint8Array`, `ptr(bytes)` and literal `0` all passed, returning 6, 6 and
  -1 respectively. So `pty-conpty.ts:126` passing `bytes` to `shim_pty_write` (declared `[I32, P,
  I32]`) is correct; no `ptr()` is missing there.
- **Repeated `cc()` is not cached**: `measured` with two `cc()` calls on one file — distinct symbol
  table and function objects, each library exposing `close`. This is why the `screen.ts` finding
  above is a real leak and not a reused handle.
- **HRESULT and pointer widths**: the `bun:ffi` declarations in `ffi.ts`, `ffi-core.ts`,
  `ffi-dialog.ts`, `ffi-webview.ts`, `ffi-preview.ts`, `notify-tray-ffi.ts`, `pty-ffi.ts` and
  `keychain-ffi.ts` still match the C prototypes; 32-bit HRESULTs use `i32`, pointer-sized HWNDs use
  `ptr`/number, and the `shim_i64` readbacks are the ones that genuinely widen. No regression from
  hunt-21's ABI audit.
- **hunt-21 Windows findings now fixed by source**: `SHIM_SWP_FRAME_ONLY` includes NOSIZE/NOMOVE
  (`11_win32_style.c:56-67`); `shim_dialog_reset` zeroes the whole name buffer (`48_dialog.c:118-130`);
  `WM_DESTROY` frees both the surface and min-size slots (`20_class.c:60-70`); fullscreen records are
  keyed by label and checked against hwnd and `WS_POPUP` (`window-fullscreen-adapter.ts:35-52`);
  `shim_browser_surface_new` returns `-1` on failure and the adapter tests `<= 0`
  (`57_browser.c:43-57`, `browser.ts:88-93`); over-long pty args are a spawn failure
  (`65_pty_open.c:133-149`); keychain target names reject backslashes and long secrets are re-read
  (`keychain.ts:31-41,59-79`). None of these is reported again.
- **Still open from hunt-21, not repeated here**: every `screen.list` reports `scale: 1`
  (`47_screen.c:65`) and `handler_wait`/`TrackPopupMenu` reenter the pump during a WebView2
  environment wait; both were carried forward unchanged and are already filed.
- **Surface slot lifecycle**: `41_surfaces.c` reserves a slot only at `shim_webview_bind`, so failed
  creates before attach do not consume one of the eight slots; `shim_surface_release` is idempotent;
  closing the last app window still posts quit only when no surface remains (`20_class.c:68`).
- **ConPTY teardown and buffers**: pipe ends are closed on the parent side, `CreateProcessW` gets
  `PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE` by value, the reader thread is bounded and a reader that did
  not exit leaves its slot spent rather than reused (`66_pty_io.c:123-169`). Both wide buffers in
  `65_pty_open.c:116-117` stay under the TinyCC frame threshold.
- **Keychain C mapping**: `shim_keychain_status` keeps ERROR_NOT_FOUND separate from a refusal;
  `get` re-reads at the reported length and refuses after three attempts, and `list` re-reads at the
  reported byte count. The store is its own compiled unit cached once per process.
- **Modal dialogs and COM apartment**: `shim_com_init` requests STA; the file panels run on the
  thread that owns the HWND, with `OpenClipboard`/`CloseClipboard` paired on every clipboard return
  and `GlobalFree` only when `SetClipboardData` did not take ownership (`50_clipboard.c:63-90`).
- **Tests read for coverage, not run**: `screen.test.ts`, `browser-navigation.test.ts`,
  `tray-adapter.test.ts`, `platform.test.ts` and `preview-abi.test.ts` all inject fakes and therefore
  cannot see the five default-injector, missing-callback or unvalidated-input paths above.
