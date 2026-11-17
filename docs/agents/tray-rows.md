# Lane L — tray rows owned by the page

**Finding: wrong premise; no code change.** Brief says crust has `create/items/...` and cannot replace rows after creation. Actual command is `setMenu` (`TRAY_COMMANDS` in `tray-types.ts:90`), and it replaces the whole menu in place.

Evidence: `status-bar-item.ts:101-122` `setMenu` rebuilds via `tray_menu_begin/add/end` on the same `NSStatusItem`; `50_menu.c:61-68` calls `[item setMenu:]` on that same item — no `tray_create`/`tray_destroy`, so no icon flicker. Click trampoline is one per process (`status-bar-item.ts:20-24`) and `clickRoute` reads the refreshed `entries`, so new rows route to new handlers. `setTitle` writes the same item.

Proof tests added (both pass):
- `status-bar-item.test.ts` "rows replace in place: new handlers fire, old rows go, title reads back" — swaps menu, checks new handlers fire / old row gone / `currentStatusBar()` unchanged / AppKit title readback after swap.
- `tray.test.ts` "setMenu called again replaces rows without destroying the item" — second `setMenu` replaces rows, `tray:click` carries the new label, no destroy.

Not fixed: no source defect to fix — do not add `setItems`. `bun check` has 1 unrelated error in another lane's `src/plugins/keychain-registry.test.ts:43` (TS2554). My files: `bun test` 21 pass, `check:lines` pass, `bun fmt` clean.
