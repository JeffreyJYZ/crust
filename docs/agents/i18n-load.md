# Lane N — i18n catalogue from disk

Finding: crust's `crust:i18n` only took a catalogue object via `createI18nPlugin({ messages })`, so an app had to hand-write an `import` per locale JSON. Butter loads `locales/*.json` by directory.
Fix: added `i18n.load({ directory })` — reads every `*.json` basename as a locale and merges it into the live catalogue; the runtime's empty catalogue now fills at runtime.

- `src/plugins/i18n-load.ts:16` — pure `loadCatalogue(directory)`; invalid JSON, non-object docs and unreadable dirs raise `bad-request` naming the path, never silently skipped (unlike Butter).
- `src/plugins/i18n.ts:108` — `load` command; `catalogue` is now `let`, loader injected via `I18nOptions.loader` (default `loadCatalogue`) so the command is testable without disk.
- `src/plugins/i18n-types.ts` — added `CatalogueLoader`, `LoadResult`, and the `load` command to `I18nPlugin`.
- `site/app/docs/guides/i18n/page.mdx` — command-table row plus one line of behaviour.
- `src/plugins/i18n-load.test.ts` — 10 tests: basename→locale, other files ignored, invalid/non-object JSON, missing dir, empty dir, real-dir load then translate, merge across two loads, loader receives directory, bad arg, empty result.

Checks: `bun check` clean (712 files); targeted tests 19 pass / 0 fail; `bun check:lines` PASS; formatted changed files. No barrel edit needed — `load` is a plugin command, not a new barrel export.

Decision: kept `not-implemented` hint text unchanged so existing tests stay valid; chose a runtime command over a barrel-only helper so no other lane's file was touched.
