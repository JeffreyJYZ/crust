# Lane F7 — fix-accessibility-i18n

## Measured facts

- `Intl.PluralRules("ar").select` returns all six categories: `0→zero, 1→one, 2→two, 3→few, 11→many, 100→other`. The old `pluralCategory` collapsed every non-`one` to `other`, so a catalogue keyed on `items_zero/two/few/many` never matched.
- `createI18nPlugin({locale:"de", adapter:{preferredLocale:()=>"en"}})` reported `locale() = en` while `translate() = de` — the two resolution orders disagreed. The guide's stated order is page choice → configured → system → first key; `preferred()` already implements it, `locale()` did not.
- `bun check` at 2026-11-18 failed on `src/platform/windows/keychain-ffi.ts:127` and `keychain.test.ts:24` — another lane's in-flight `list` binding, not this lane. Scoped `bun check` on the i18n files is clean.

## Changes

- `src/plugins/i18n-locale.ts`: `textDirection` (RTL base-language set) and `localeAttributes` (`{lang,dir}`).
- `src/plugins/i18n-messages.ts`: `pluralCategory` returns all six `Intl` categories; `pluralForms` tries exact → `other` → `one`.
- `src/plugins/i18n.ts` / `i18n-types.ts`: every successful answer now carries `dir`; `locale()` uses `preferred()` so it cannot disagree with `translate()`. Re-exports the direction helpers.
- Templates react/vue/svelte: `<html dir="ltr">` plus a runtime binding in each entry that sets `document.documentElement.lang`/`dir` from `navigator.language` (RTL set mirrored).

## Not fixed (out of lane scope)

- `templates/next/app/layout.tsx` and `templates/default/public/index.html` carry `lang="en"` / bare `<html>` and have no binding. Ownership was `templates/*/index.html` and `templates/*/src/**`; these two paths are outside it.
- Finding 4/5 of the report (page AX-tree access, DOM focus) need native/webview work, not `src/plugins/accessibility*.ts`.

## Proof

- `bun test src/plugins/i18n*.test.ts`: 37 pass, 0 fail.
- `bun check <i18n files>` clean; `bun run check:lines` PASS.
