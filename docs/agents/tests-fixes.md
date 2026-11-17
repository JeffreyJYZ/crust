# tests-templates lane — fix wave

Owned: `darwin/{arity,dialog}.test.ts`, `darwin/status-bar-*.test.ts`, `templates/react/package.json`, `scripts/line-cap.ts`, `examples/dogear/src/selfcheck/panels.tsx`.
Reports: `docs/reviews/defects-wave3/14-tests.md`, `15-templates.md`.

## Fixed

- `src/platform/darwin/arity.test.ts:81` — `shimCSource()` → `cSource()`. No prefix filter: the units use `shim_*`, `tray_*`, `crust_notification_*` and `menu_api_*`, so filtering by one prefix is what hid 27 binding files.
- `src/platform/darwin/arity.test.ts:99` — `bindingSource()` → `bindingSources()`. Walks every non-test `.ts` with a `symbols: {` block instead of returning the first file containing `shim_window_new`. Merges all declared arities into one map; records conflicting declarations.
- `src/platform/darwin/arity.test.ts:143,153` — added coverage guards: ≥8 binding files read, and `shim_clipboard_read` (2), `menu_api_item` (6), `tray_set_title` (3), `crust_notification_post` (3) declared; no symbol declared twice with different arities.
- `src/platform/darwin/dialog.test.ts:3,143` — the "default dialogPlugin" test now imports and calls the real default export, asserting `name === "dialog"` and `openPanel()` answers `not-implemented` with `requires === "NSOpenPanel"`. Previously it only asserted an imported function was defined.
- `src/platform/darwin/status-bar-item.test.ts` (new) — drives the real compiled AppKit adapter (no fake, no cursor): one-live-bar rule, idempotent destroy and slot reuse, title readback (including the >512-byte skip), show/hide visibility, click trampoline routing, handler-free and out-of-range rows, `setMenu` copy semantics, empty-menu detach, and all six destroyed-item guards. `afterEach` destroys any live bar so nothing leaks into `tray.test.ts`.
- `src/platform/darwin/status-bar-helpers.test.ts` (new) — pure halves were also untested: `cbuf` UTF-8 byte count and cache, `ptrValue` refusing BigInt/undefined/string, `checked` naming the refused call, `STATUS_BAR_SYMBOL_NAMES` uniqueness, and `readbackFrom` mapping `-1` to `null` versus flags/frame copied as primitives.
- `templates/react/package.json:8` — `build` is now `crust build`; the config's `beforeBuildCommand` already runs Vite. The `frontend` script remains the explicit frontend-only path.
- `examples/dogear/src/selfcheck/panels.tsx:2,20,47` — panels are steps 10 and 11, not 9 and 10 (`steps.tsx` emits nine checks). Header, inline step numbers and the step-9 error string corrected.
- `scripts/line-cap.ts:10` — `templates` added to `ROOTS`; `check:lines` now walks the shipped template tree.

## Tests added

- `src/platform/darwin/arity.test.ts` — every-binding-file coverage, conflicting declarations, arity of four symbols from non-index bindings. Mutation proof: changing `shim_clipboard_read` in `shim/90_clipboard.c` from 2 to 3 args fails the arity comparison; old test stayed green.
- `src/platform/darwin/dialog.test.ts` — default export answers not-implemented. Mutation proof: giving `dialogPlugin` an adapter makes the assertion fail.
- `src/platform/darwin/status-bar-item.test.ts` — 10 cases listed above.
- `src/platform/darwin/status-bar-helpers.test.ts` — 6 cases listed above.
- `scripts/release/template-build.test.ts` — `build` is `crust build` with no `vite`; config still owns the single `vite build`; `frontend` escape hatch remains. Mutation proof: restoring the old double-build script fails it.
- `scripts/release/dogear-steps.test.ts` — nine `await check(` in `steps.tsx`, panels labelled 10–11, no stale `step 9` / `9–10`.
- `scripts/release/line-cap-roots.test.ts` — `ROOTS` includes all five shipped trees.

All 34 tests pass; `bun fmt` on the ten owned files made no changes.

## Not fixed

- `15-templates.md:2` — `site/app/docs/start/files/page.mdx:42` omits `app/about/page.mdx` from the `--next` file list. `site/` is outside my ownership, and the `docs` lane owns only `site/app/docs/reference/{parity,config}/page.mdx`, so no lane in this wave covers that file. Needs an owner (coordinator or docs lane).
- `15-templates.md:3` (README half) — `examples/dogear/README.md:181` still says `steps.tsx (1-8), panels.tsx (9-10)`. README is outside my owned list; the source comments and the new test are correct.
- `bun check` reports two errors in other lanes' files: `src/plugins/logging-level.test.ts:28` (`table.write` possibly undefined) and `src/plugins/shortcuts.ts:164` (`ok: boolean` not `true`). Neither is mine.
- `bun run check:lines` fails on other lanes' files: `src/packaging/extension-compile.test.ts` (265) and `src/runtime-plugins.ts` (203). No template file exceeds 200 lines.

## Durable lessons

- `mock.module()` is process-global in Bun 1.4.4 and is **not** undone by `mock.restore()` or a second `mock.module()` call. A test that mocks `status-bar-ffi.ts` breaks `tray.test.ts` in the full suite. Drive the real AppKit unit instead — `createStatusBar()` works in a plain `bun test` process on macOS and `activateRow()` fires the target/action without moving the cursor.
- The arity guard's C side must gather **all** `.c` files, not just those containing `shim_`: `notifications/*.c` defines `crust_notification_*` and `status_bar/*.c` defines `tray_*`, both with `args:` declarations in binding modules.
- `expect(TUPLE).toContain(variableString)` fails typecheck because Bun narrows `toContain` to the literal union. Widen with `[...TUPLE] as string[]`.
- Source-text tests need a mutation proof: `sd` exits 0 on no match, so confirm the file actually changed before trusting a red/green result.
