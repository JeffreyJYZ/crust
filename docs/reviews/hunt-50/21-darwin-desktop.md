# hunt-50 · darwin desktop surfaces: clipboard, menu, dialog, tray, dock (21)

Read-only source review of `src/platform/darwin/` and the plugin call sites for the five desktop
surfaces. Scope: `clipboard.ts` + `shim/90,101`, `menu-api.ts`/`menu-context.ts`/`menu-readback.ts`
+ `shim/55,98,99`, `dialog.ts`/`panel-shim.ts`/`panel-status.ts`/`sheet.ts` + `shim/60,70,75,80,85`,
`status-bar*.ts` + `status_bar/*.c`, `dock.ts`/`dock-ffi.ts` + `shim/104`, `dock-icon.ts`. Search was
`rg`/`fd` only; no app launched, no cursor moved, no test run, no source changed.

**Count: 6 findings** (1 high, 3 medium, 2 low). Worst is finding 1. The lens was thread and
execution-context assumptions: every native call here is made from Bun's main thread and the pump
drives AppKit on that same thread, so the failures are not classic data races. They are failures of
state and control flow that span the boundary between a command and an AppKit callback arriving
later on that thread, or that block the thread the bridge depends on.

---

## 1 (high, worst) — one tag namespace for all menus: `showContext` repoints the live app menu's clicks at the context menu's ids

- `src/platform/darwin/menu-api.ts:32-35` — one module-global `ids` array; the comment says a click
  carries an index into "the live id list".
- `src/platform/darwin/menu-api.ts:67-91` — one `JSCallback` per process; its handler reads the
  sender's tag in C and does `ids[tag]`, then calls `route?.(id)`. Nothing in the callback records
  which menu the sender belongs to.
- `src/platform/darwin/menu-api.ts:101-106` — `build()` resets `ids` and assigns fresh tags on every
  build, whether the build is for the app menu or a context menu.
- `src/platform/darwin/menu-api.ts:109-116` — `setAppMenu()` installs the built menu as
  `-[NSApp mainMenu]`; `showContext()` builds another menu with the *same* helper and pops it. The
  app menu stays installed, with rows whose tags still index the old list.
- `src/platform/darwin/shim/98_menu_api.c:78-99,120-140` — every row of both menus uses the same
  runtime target class and the same `crustMenuSelected:` IMP; the row's `tag` is the only identity.
- `src/plugins/menu.ts:84-87` — the selection is emitted as `{ id }` from whatever ids the callback
  found.

**Reached:** a page calls `menu.setAppMenu` with rows `[{ id: "file.open" }, { id: "file.save" }]`
(ids `["file.open","file.save"]`, main-menu rows tagged 0 and 1). It later calls `menu.showContext`
with rows `[{ id: "ctx.copy" }]`; `build()` overwrites `ids` with `["ctx.copy"]`. The context menu is
dismissed, but the app menu installed by the first call is still on the bar. The user clicks "Open"
in the app menu: AppKit sends `crustMenuSelected:` with tag 0, the callback reads `ids[0]`, and the
page receives a `menu` event with `id: "ctx.copy"`. Every app-menu row past index 0 resolves to
`undefined` and is silently dropped (`menu-api.ts:77`). The same poisoning follows `menu.reset`
(`:117-121` sets `ids = []`) if any custom row is still clickable. The AppKit callback is out of band
from the command that installed the row and assumes the most recent build produced the click; that
assumption is false as soon as two menus coexist. No concurrency is needed.

---

## 2 (medium) — `showContext` blocks the JavaScript thread and the pump inside AppKit's tracking loop

- `src/platform/darwin/menu-context.ts:9-16` — states the popup "blocks inside AppKit's own tracking
  loop until the menu is dismissed, which is why no test opens one".
- `src/platform/darwin/shim/99_menu_context.c:8-25` — `popUpMenuPositioningItem:atLocation:inView:`
  is a synchronous `objc_msgSend` from the FFI call; it does not return until dismissal.
- `src/platform/darwin/menu-api.ts:113-116` and `src/plugins/menu.ts:142-151` — the command handler
  calls it inline, so the `showContext` invoke's response is held by the same blocked thread.
- `src/platform/darwin/sheet.ts:14-16` — the dialog surface explicitly rejects this shape: a
  blocking modal "stops the JavaScript thread, the Cocoa pump and every in-flight invoke".

**Reached:** any page awaiting `menu.showContext`. AppKit's nested loop keeps the menu interactive
and keeps drawing, so the UI looks alive, but no `crust` invoke is answered, no SSE frame is written
and no `setTimeout` pump tick runs (`platform.ts:64-79`) until the user dismisses the menu. The
parity page already records the limitation (`site/app/docs/reference/parity/page.mdx:35`, "modal"),
so this is a known thread assumption rather than an unnoticed one, but it is still a bridge freeze
that the dialog half went to lengths to remove.

---

## 3 (medium) — context menu needs a key window; a background app gets a false "selector absent" error

- `src/platform/darwin/shim/99_menu_context.c:10-14` — the only window source is `-[NSApplication
  keyWindow]`; nil returns 0. There is no `mainWindow`/first-visible fallback.
- `src/platform/darwin/shim/70_sheet_block.c:57-89` — the dialog half fixed exactly this case:
  "`keyWindow` is nil whenever the process is not the active app — which an unbundled `bun`
  process frequently is", and falls back through `mainWindow` to the first visible window.
- `src/platform/darwin/menu-context.ts:15` — the 0 becomes `checked(...)`, whose text is hardcoded
  to "was refused by AppKit (a selector it needs is absent)" (`status-bar-args.ts:33-38`).

**Reached:** run the app with `crust dev` (unbundled process, macOS 14+ restricts self-activation)
or otherwise while another app is frontmost, then call `menu.showContext`. `keyWindow` is nil, the
popup never opens, and the page receives `{ ok: false, code: "handler-error", message: "crust:
popUpMenuPositioningItem: was refused by AppKit (a selector it needs is absent)" }`. The selector is
present; there is simply no key window. The same app's file panels work in that state because of the
fallback above.

---

## 4 (medium) — an awaited sheet has no timeout, so a panel whose completion never fires hangs its invoke forever

- `src/platform/darwin/sheet.ts:18-31` — `awaitSheetResult` loops on `done()` with a 16 ms timer and
  no deadline or iteration cap.
- `src/platform/darwin/dialog.ts:61-73,87-98` — both `pickOpen` and `pickSave` await it; the bridge
  awaits the plugin handler (`bridge/server/invoke.ts:70-71`).
- `src/platform/darwin/panel-status.ts:51-58` — a `SHEET_CANCEL_TIMEOUT_MS` (2 s) exists, but only
  `dialog.cancel()` uses it (`dialog.ts:140-149`).

**Reached:** a sheet is started (`SHIM_PANEL_SHEET_STARTED`) but its completion handler never runs —
for instance the panel's window goes away before the user answers, or AppKit refuses the handler on
this system. `panel_sheet_done` stays 0 (`shim/60_panels.c:28`), so the `setTimeout` loop never exits
and the `dialog.openPanel` invoke never settles. The page must know to issue a separate
`dialog.cancel`; nothing in the pending invoke reports that it is stuck. The windowless branch has
the same exposure because it now also reports through the poll (`dialog.ts:90-98`).

Note the companion stale comment: `dialog.ts:3` still says the no-window path "falls back to
`-runModal`, which does block", while `dialog.ts:90-93`, `shim/75_open_panel.c:65-81` and
`site/app/docs/guides/dialogs/page.mdx:60` all say it uses `beginWithCompletionHandler:` and does
not block. The code is non-blocking; the header is wrong.

---

## 5 (low) — a tray click is emitted through the `ctx` captured by the last `setMenu`, not by the listener

- `src/plugins/tray.ts:116-127` — `setMenu` builds `onClick` closures that capture that command's
  `ctx` and call `emitClick(ctx, ...)`.
- `src/platform/darwin/status-bar-item.ts:112-133,156-160` — the adapter keeps those handlers and
  invokes them from the one AppKit click trampoline.
- `src/plugins/tray-args.ts:66-75` — `emitClick` forwards to that captured `ctx.emit`.

**Reached:** with in-process callers that supply distinct `ctx.emit` values (the `app.invoke` path),
page A calls `tray.setMenu` to register its rows; page B calls `tray.setMenu` with its own rows. Both
sets of handlers live behind one status item, and later clicks can reach a handler that emits to the
page whose `setMenu` happened last rather than the page listening for `tray:click`. The bridge path
happens to share one `emit` (`bridge/server.ts:45-46`), which is why this stays low there. Like the
menu bug, this is a callback arriving on the AppKit thread with no context of its own, so the code
substitutes the most recent command's context.

---

## 6 (low) — clipboard re-read clamps a pasteboard that changed between passes, returning truncation as success

- `src/platform/darwin/clipboard.ts:141-156` — the first read into `READ_CHUNK` (64 KiB) reports a
  full length; if it exceeds the buffer, a second read goes into an exact-size buffer and
  `Math.min(length, buffer.length - 1)` is decoded.
- `src/platform/darwin/shim/90_clipboard.c:61-77` — each call fetches `generalPasteboard` anew and
  copies at most `cap - 1` bytes; the returned `length` is the *current* pasteboard's length.
- `src/platform/darwin/clipboard.ts:152-154` — the comment calls the clamp "a race guard", but it
  does not retry or report a short read.

**Reached:** another process replaces the text between the 64 KiB probe and the exact re-read with
a longer string. The second call returns the larger length but writes only `buffer.length - 1`
bytes; JS decodes those bytes and returns a truncated string, which the plugin reports as
`{ ok: true, text }`. The envelope says the full clipboard arrived. This is a cross-process race
rather than an intra-process thread race, but it is the same failing assumption: that the two
synchronous AppKit reads see one immutable pasteboard.

---

## Checked and clean

- **FFI arity and widths** for the five units: `dock-ffi.ts:63-71` matches `shim/104_dock.c`
  (`long` is 64-bit on arm64), `clipboard.ts:50-57` matches `shim/90,101`, `menu-ffi.ts:70-88`
  matches `shim/98,99`, and `status-bar-ffi.ts:48-71` matches `status_bar/*.c`.
- **JSCallback lifetime** in `menu-api.ts:68-91` and `status-bar-item.ts:23-50`: one callback per
  process held in a module variable; C never holds a dangling JS pointer. The `try/catch` around both
  routes keeps a handler exception from crossing back into AppKit.
- **Dialog one-sheet state machine**: `panel_sheet_busy()` (`shim/60_panels.c:66-72`) and the
  `panel_reset()` placement in `shim/75,80` keep a second request from clearing a live sheet's
  pointer, response or paths. The completion handler writes response and paths before the `volatile`
  done flag (`shim/70_sheet_block.c:42-55`), which is sufficient while the poll and the handler run
  on the same main thread.
- **Tray one-item rule**: `status-bar-item.ts:57-67` refuses a second live bar, matching the single
  runtime target and IMP in `status_bar/20_target.c`; destroy frees the slot and reuses the
  trampoline.
- **Dock badge/progress**: all `objc_msgSend` calls in `shim/104_dock.c` are guarded by nil checks,
  the progress indicator is owned in C for the process lifetime, and the `pinned` buffer in
  `dock-ffi.ts:94-106` stays alive across each synchronous call.
