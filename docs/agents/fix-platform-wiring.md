# Lane F6 — fix-platform-wiring

- Non-darwin branch selected no screen adapter: `linuxScreenAdapter`/`windowsScreenAdapter` were compiled and tested but never imported. `src/runtime-non-darwin.ts` now picks one by `process.platform` and injects fakes for tests; `runtime-plugins.ts` calls it.
- The report's namespace list says `shortcuts`; the actual plugin name is `shortcut` singular (`src/plugins/shortcuts.ts:... name: "shortcut"`). Test against the code, not the report.
- Seventeen bare exports answer `not-implemented`, but not every command does: `deep-link.url` answers `null`, `i18n.setLocale`/`load` do real work. Pick a refusing command per namespace in tests.
- Windows `CredEnumerateW` binding: C returns one account at a time as UTF-16LE bytes indexed by `index`, `0` ends the walk; TS re-reads at the exact byte length when the first buffer is short. `CredFree` owns the whole enumeration including nested strings. NULL filter keeps a service containing `*` or `?` literal.
- F3's access-denied work in `48_keychain.c` uses `SHIM_KC_REFUSED = -3` and `shim_keychain_status`. The additive `list` export returns the same `-3`, and the TS shim throws on any negative, so the plugin answers `handler-error`. Do not replace that path.
- `src/platform/windows/shim/48_keychain.c` is exactly 200 lines. Another addition there breaks `bun run check:lines` until something is split.
- Gate trap measured 2026-11-18: `package.json`'s test script now uses `./src ./examples`; Bun treats those as substring filters and sweeps vendored `research/electrobun/**`, giving 41 spurious failures (original explicit path list: 1598 pass, 0 fail). Belongs to the lane that owns `package.json`.
