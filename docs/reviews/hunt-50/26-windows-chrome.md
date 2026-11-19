# Windows platform "chrome" hunt — menu, tray, dock, dialog — 26

Read-only source inspection of `src/platform/windows/` (dialog, tray/notification, pump wiring) against
the darwin and linux halves of the same contracts. No source was edited, no GUI app launched.
There are **no `src/platform/windows/` menu or dock files**: `menu` and `dock` are registered bare on
non-darwin (`src/runtime-non-darwin.test.ts:24,26`, `src/runtime-plugins.ts:118,120`) and refuse with
`not-implemented`; the AppKit-shaped `requires` payloads on those refusals are already filed in
`06-menu-tray-dock.md`. The findings below are the Windows-specific defects in the four areas that do
have a native half.

**Count: 5 findings (1 high, 2 medium, 2 low).**

**Worst: F1 — the tray popup is opened with synchronous `TrackPopupMenu(TPM_RETURNCMD)`, which freezes
the JS thread (and the whole pump) for as long as the menu is up. The non-blocking `WM_COMMAND` route
that would avoid it exists in the same file but is disabled by `TPM_NONOTIFY`. Unlike the file dialog,
which genuinely has no non-modal Win32 picker, this menu has a working async path the code turns off.**

---

## F1 (high, worst) — a right-click on the tray icon blocks Bun's thread until the menu is dismissed

- `src/platform/windows/shim/62_tray.c:64-66` — `TrackPopupMenu(menu, SHIM_TPM_RETURNCMD |
  SHIM_TPM_RIGHTBUTTON | SHIM_TPM_NONOTIFY, …)` is synchronous: it does not return until the human
  picks a row or dismisses the menu. It is called from `shim_tray_proc`'s `WM_TRAY` arm
  (`62_tray.c:21-30`), which is a window procedure.
- `src/platform/windows/shim/10_prelude.c:180-190` — `shim_pump()` drains messages with
  `DispatchMessageW` inline; the `WM_TRAY` dispatch therefore runs `TrackPopupMenu` inside the pump
  slice. The pump is driven from `src/platform/windows/platform.ts:99-104` on Bun's main thread.
- `src/platform/windows/shim/62_tray.c:31-35` — a `WM_COMMAND` handler that records `g_click` from the
  menu id exists and is the non-blocking route, but `TPM_NONOTIFY` (`62_tray.c:13`) suppresses
  `WM_COMMAND` from this menu and `TPM_RETURNCMD` makes `chosen` the source of truth (`62_tray.c:69`).
  The handler is dead for the one menu this unit shows.
- Contrast: darwin shows the status menu through AppKit's own event loop
  (`src/platform/darwin/status-bar-item.ts:112-133`) and linux uses a GTK menu popup
  (`src/platform/linux/tray-adapter.ts`), neither of which blocks the JS thread; the darwin file
  dialog doc (`src/platform/darwin/dialog.ts:2-3`) explicitly treats non-blocking UI as the contract.

**Reached:** the app is pumping; the human right-clicks the notification-area icon. `DispatchMessageW`
enters `shim_tray_proc`, which enters `shim_tray_menu_open` and blocks in `TrackPopupMenu`. Until the
menu closes, no pump slice completes, so `platform.pump`'s rearming `setTimeout` never runs, no
`dialog.cancel` / invoke / page timer fires, and the tray poll at `platform.ts:102` cannot deliver any
other click. Leave the menu open and the app is frozen. This is a platform difference that looks like
a bug: the sibling platforms keep serving JavaScript while a menu is open, and this unit already
carries the code that would do the same on Win32.

**Smallest fix:** drop `TPM_RETURNCMD` and `TPM_NONOTIFY` from the `TrackPopupMenu` flags and let the
existing `WM_COMMAND` arm (`62_tray.c:31-35`) record `g_click`; the adapter's `pollClick()` already
reads `g_click`, so no other layer changes.

---

## F2 (medium) — a tray label containing `\n` becomes two menu rows on Windows (and Linux), shifting every later click index

- `src/platform/windows/tray-adapter.ts:95` — `const joined = next.map((item) => item.label).join("\n")`.
- `src/platform/windows/shim/62_tray.c:74-91` — `shim_tray_menu` splits that string on `\n` into
  `g_labels[index]` and sets `g_label_count = index` from the *number of split lines*, not the number
  of items the adapter sent. A single label `"line1\nline2"` yields two rows.
- `src/platform/windows/shim/62_tray.c:54,69` — rows are given ids `i + 1` and the chosen id is written
  back as `g_click = chosen - 1`, so a click on the second fragment returns the index of the *next*
  item. `src/platform/windows/tray-adapter.ts:125-136` then dispatches `items[index].onClick` and the
  plugin emits `{ index, label }` for that other row (`src/plugins/tray.ts:117-127`).
- The argument reader accepts any non-empty string as a label (`src/plugins/tray-args.ts:53-61`), so a
  newline is legal input. The C max is checked on `next.length` (`tray-adapter.ts:89-94`), not on the
  parsed line count, so a 12-item menu with one embedded newline overflows the 12-row C table at
  `62_tray.c:9,80-89` (the 13th parsed row is dropped).
- Contrast: darwin adds each label as one item with its own index
  (`src/platform/darwin/status-bar-item.ts:125-132`), so a newline stays inside one `NSMenuItem`.

**Reached:** `tray.setMenu({ items: [{ label: "Open\nDocs", onClick: open }, { label: "Quit", onClick: quit }] })`.
C builds three rows. Clicking "Docs" returns index 1, which is the `Quit` row in the adapter's `items`,
so `quit` runs and the page receives `tray:click { index: 1, label: "Quit" }`. Reached on every Windows
menu built from labels that legitimately contain a line break.

**Smallest fix:** reject `\n` in `readItems` (or escape it in the adapter and unescape in C) so the
`\n` wire separator cannot collide with label content; apply to the linux adapter too.

---

## F3 (medium) — `dialog.cancel()` is a no-op on Windows, the only platform where a page cannot dismiss a panel it opened

- `src/platform/windows/dialog.ts:156` — `cancel()` unconditionally returns `{ cancelled: false, paths: [] }`.
  The reason is the modal on the main thread (`dialog.ts:6-12`, `shim/49_dialog.c:57,73`): JS does not
  run while the panel is up.
- Contrast: darwin ends a live sheet and waits for its completion handler
  (`src/platform/darwin/dialog.ts:133-157`); linux calls `shim_dialog_cancel` and truly releases the
  panel (`src/platform/linux/dialog.ts:175-180`). On both, `cancelled: true` is a real answer.
- The plugin exposes one cross-platform command and documents `cancelled: false` only as "nothing was
  left to end, an ordinary race with the user" (`src/plugins/dialog.ts:46,103-106`). On Windows it is
  *never* true, so the documented meaning is unused and the capability is silently absent.

**Reached:** a page calls `crust.dialog.openPanel()` then, from another handler or timer,
`crust.dialog.cancel()` expecting to close the picker. On Windows the cancel invoke cannot even run
until the modal returns; when it does it reports `cancelled: false`, and the user (not the page) had
to end the panel. A page that treats `cancel()` as the way to free the single panel slot has no way
to do so. The code comments admit the limitation, but the cross-platform plugin contract does not.

**Smallest fix:** surface the capability in the plugin result rather than a magic `false` — e.g. a
`not-implemented` with `requires: "non-blocking-panel"` on the Windows adapter, so a page can branch —
or document the Windows modal limitation in `src/plugins/dialog.ts` where the cross-platform contract
lives.

---

## F4 (low) — a stale recorded click can fire a different row when `setMenu` replaces the menu before the next poll

- `src/platform/windows/tray-adapter.ts:125-136` — `pollClick` drops a click only when `items[index]` is
  `undefined` (`:130`). The comment at `:120-124` claims this stops "the wrong handler", but it only
  handles the case where the new menu is shorter than the recorded index.
- `src/platform/windows/shim/61_notify.c:84-88` — `shim_tray_click()` returns and clears `g_click`;
  nothing ties that int to the `items` array that was live when the click happened.
- `src/platform/windows/shim/62_tray.c:31-35,69` and `src/platform/windows/platform.ts:99-102` — the
  click can be recorded by a message dispatch, and the replacement of `items` happens on a separate
  JS turn, so the two can belong to different menus.
- `src/platform/windows/tray-adapter.test.ts:159-162` exercises only an out-of-range index (4) against
  an empty menu; the equal/longer replacement case is untested.

**Reached:** `setMenu([A, B])`, a row is clicked and recorded as index 1, `setMenu([X, Y, Z])` runs
before the pump slice that calls `pollTrayTick()`, then `pollClick()` finds `items[1] = Y` and fires
`Y`'s `onClick` plus `tray:click { index: 1, label: "Y" }` — not the row the human clicked.

**Smallest fix:** version the menu (store a generation with `items` and a generation stamped on the
click) and drop clicks whose generation differs; at minimum clear `g_click` inside `setMenu`.

---

## F5 (low) — an over-long filter string leaves `lpstrFilter` with a single terminator, so comdlg32 reads stale bytes as filter entries

- `src/platform/windows/shim/48_dialog.c:147-148,156-157` — on a UTF-16 conversion failure
  (`written <= 0`, which `shim_utf16` returns when the caller's cap is exhausted,
  `shim/10_prelude.c:149-155`), `shim_dialog_filters` returns early.
- `src/platform/windows/shim/48_dialog.c:160-161` — the double-NUL terminator `g_dlg_filter[n] = 0`
  is after that loop and is skipped by the early return. `shim_dialog_reset()` only zeroes
  `g_dlg_filter[0]` (`48_dialog.c:123`), so the byte at `n` and beyond can be from a previous pick.
- `shim/49_dialog.c:28` hands `g_dlg_filter` to `OFN.lpstrFilter`; that API requires two NULs.

**Reached:** `dialog.openPanel({ filters: [ …about 2 KB of name/pattern text… ] })` drives `n` to the
loop bound `SHIM_DIALOG_FILTER_MAX - 4` (`48_dialog.c:135`); the next `shim_utf16` gets a cap of
`2048 - n - 2` too small, returns -1, and the function returns without the final terminator.
comdlg32 then walks past the single NUL into `g_dlg_title` and shows phantom filters (or reads out of
the intended buffer). The linux parser (`src/platform/linux/shim/84_dialog_calls.c:8-35`) always
finishes its group cleanly, so this is a Windows-only corruption path.

**Smallest fix:** write `g_dlg_filter[n] = 0` before every early return (or `break` to a single
termination point at the end of the function).
