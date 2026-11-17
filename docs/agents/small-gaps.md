# Lane U — tray tooltip, navigation loadUrl, store named stores (2026-11-17)
Source ledger: `docs/agents/butter-coverage.md` F3/F6/F7.
## fixed
- `store.ts` + new `store-scope.ts`: every command takes optional `{ name }`; the empty name keeps `store.json`, a named one uses `store.<name>.json`, one cached `StoreScope` per name. Traversal-style names are `bad-request` before a path is built.
- `tray.ts`/`tray-types.ts`/`tray-args.ts`/`tray-fake.ts`: added `setTooltip({ text })`, `TrayTooltipResult`, optional `setTooltip?` on `TrayNative`, `TRAY_COMMANDS` now six. No setter answers `not-implemented` naming `setToolTip:`; no adapter names `NSStatusBar`.
- `navigation.ts` (loadUrl split to `navigation-load.ts` for the 200-line cap)/`navigation-types.ts`/`navigation-target.ts`/`navigation-fake.ts`: added `loadUrl({ url, label? })`, optional `loadUrl?` on the adapter, a `loadArgs` validator. Bad URL is `bad-request`; no load path answers `not-implemented` naming `loadRequest:`.
## tests
- New `store-named.test.ts`, `tray-tooltip.test.ts`, `navigation-loadurl.test.ts`; updated `tray.test.ts`, `navigation-label.test.ts`, `plugins.test.ts`. 13-file `bun test` 79 pass / 0 fail.
## not fixed (other owner)
- darwin native setters: `status_bar/*.c` needs a `setToolTip:` export, `shim/109_navigation_state.c` a load-by-URL export, plus adapter/ffi/symbol plumbing. The plugin answers by name until those land; no app omitting the new commands is affected.
## checks / ledger
- Own files `bun check` clean (133 files), `bun fmt` applied, `check:lines` PASS. Whole-tree `bun check` blocked by Lane P's in-flight `accessibility-announce.test.ts`, not mine.
- `butter-coverage.md` F3/F6/F7 flipped to `same`; parity page Tray/Store/Navigation rows updated.
