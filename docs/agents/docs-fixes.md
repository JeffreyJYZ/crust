# docs lane — fix wave report

## fixed

- `site/app/docs/reference/parity/page.mdx:28` (13-docs #2) — `25 commands` → `26 commands`, matching `WINDOW_COMMANDS` in `src/plugins/window-types.ts:141-168` and the imports page.
- `site/app/docs/reference/parity/page.mdx:43` (13-docs #1) — `notification.send` → `notification.notify` (plus `notification.requestPermission`), the two commands `createNotificationPlugin` actually registers (`src/plugins/notification.ts:78-79`).
- `site/app/docs/reference/parity/page.mdx:50` (13-docs #3) — `app.start()` → `app.run()`; the launch URL is claimed in `App.run()` (`src/app.ts:114,136`), and `App` has no `start()`.
- `site/app/docs/reference/parity/page.mdx:41-42` (13-docs #4) — `dialog.open`/`dialog.save` → `dialog.openPanel/savePanel/cancel` (`src/plugins/dialog.ts:74,91,108`); `fs.read/write/list/stat/rename/remove` → `fs.readTextFile/writeTextFile/list/stat/remove/rename` (`src/plugins/fs.ts:108,116` and the files guide).
- `site/app/docs/reference/config/page.mdx:71-73` (13-docs #5, 19-config #5 — same defect, fixed once) — default `all five` → `all built-ins`; paragraph now states absent/`[]` registers the full runtime array (core 7 + `window`/`store`/`shell`/`updater` + platform natives), and the unknown-plugin error tail is the runtime-built list, not the stale fixed five. The tail text no longer claims `v1 ships fs, dialog, notification, tray, window`.
- `site/app/docs/reference/config/page.mdx:65` (19-config #4) — added the missing `build.urlScheme` row (accepted by `validate-build.ts:7,18`, written to `Info.plist` by `crust build`).
- `site/app/docs/reference/config/page.mdx:75-81,91-97,99-106,108-117` (19-config #4) — added the four absent root sections so the page covers all ten `ROOT_KEYS`: `extensions` (flat project-relative file array, discover `extensions/*.ts` when absent), `fs` (`scope`, absolute prefixes only), `shell` (`allow` deny-by-default, absolute `cwdRoot`), `updater` (`endpoint`/`pubkey`/`autoCheck`/`allowFileUrl`; the section's presence registers `crust:updater`). Each links to its guide.

## tests added

- `scripts/docs-reference.test.ts` — 7 tests, 36 assertions. Reads both MDX files plus source of truth so a stale doc fails: window count derived from `WINDOW_COMMANDS`; build table must contain every `BUILD_KEYS` entry; one `## \`key\`` heading per key parsed out of `ROOT_KEYS` in `schema.ts`; core plugin names from `corePlugins` must appear in the plugins default text; stale strings (`notification.send`, `25 commands`, `app.start()`, `dialog.open`, `dialog.save`, `fs.read/write`, `all five`, the fixed error tail) must be absent.
- Red-state proof: `git show HEAD:<page> | rg ...` finds every stale string at the reported line; the same assertions pass on the edited pages.

## checks

- `bun test scripts/docs-reference.test.ts` — 7 pass, 0 fail.
- `bun run check:lines` — PASS.
- `bun run check:links` — PASS (51 routes; the four new guide links resolve).
- `bun fmt scripts/docs-reference.test.ts` — formatted; re-ran the test, still green. Bun does not format `.mdx`; tables were aligned by hand against the file's existing style.
- `bun check` — 3 errors, none mine: `src/cli/parse.ts:63,68` (TS2322/TS2345, cli lane) and `src/platform/linux/platform.test.ts:13` (TS2322, linux/tests-templates lane). Not touched.

## not fixed

- None. 19-config #4 notes `site/app/docs/start/files/page.mdx:62` calls this page "The full table"; that other page is not mine, and it is now accurate, so no change is needed there.

## notes for the next lane

- `plugins` default is the **full runtime plugin array**, not `corePlugins`: `selectedPlugins()` (`src/runtime-shim.ts:39`) returns every plugin passed in, so naming no plugins registers all of them. The unknown-plugin message is built from `core.map(p => p.name)` at `:44` — it can never be a fixed five.
- `scripts/docs-reference.test.ts` is a new file; the root `bun test` script lists only `src/bridge src/plugins src/platform src/cli src/packaging scripts/release`, so the gate will not pick it up automatically. Run it explicitly, or add `scripts/` to the test script.
- The config lane's in-flight fix to `src/config/validate-shell.ts` now refuses a relative `cwdRoot`; the new `shell` section documents that absolute requirement.
