# Lane 11 — accessibility and i18n

Field: users who are not the developer. Screen readers, keyboard-only, locale, RTL.

Method: read `src/plugins/accessibility*.ts`, `src/plugins/i18n*.ts`, the darwin adapters and their C shims, all five `templates/*`, both guides, the parity and limits pages. Ran the probes quoted below. Only the two owned files were written; no source touched.

## Ranked findings

### 1. RTL locales translate text but never flip layout or voice — shipping blocker for ar/he/fa

- `i18n` resolves and returns a string; nothing in the repo binds a locale to the document. Command `rg -n 'dir=|document\.documentElement|\.lang\s*=|setAttribute\(["'\'']lang|rtl' src templates examples site/app/docs` found no DOM direction or language write, only `src/plugins/i18n-messages.ts:21` naming PluralRules.
- Templates hardcode the language: `templates/react/index.html:2`, `templates/vue/index.html:2`, `templates/svelte/index.html:2` and `templates/next/app/layout.tsx:13` all carry `<html lang="en">`; `templates/default/public/index.html:2` is bare `<html>` with no `lang` at all.
- A page calling `setLocale("ar")` therefore renders LTR and tells VoiceOver the document is English. The string is right; pronunciation and layout are wrong. `crust:i18n` exposes no way to set `dir` or `lang`, so the app must infer it itself from the returned `locale`.

### 2. Plurals are silently wrong for six-category locales — ar, cy, ga, ru, pl, cs, ...

- `src/plugins/i18n-messages.ts:24-30` returns `"one"` only when `Intl.PluralRules.select` says `"one"`, otherwise `"other"`; `:85` tries only `${key}_one` then `${key}_other`.
- Command `bun -e 'for (const c of [0,1,2,3,11,100]) console.log("ar count="+c+" -> "+new Intl.PluralRules("ar").select(c))'` → `zero, one, two, few, many, other`. Counts 0, 2, 3 and 11 all collapse to `_other`, which one catalogue entry cannot express distinctly.
- The guide admits the collapse (`site/app/docs/guides/i18n/page.mdx:50`: "every other category (`few`, `many`, `zero`) lands on `_other`"), but an Arabic product still shows the wrong form for most counts. This is wrong output, not just a missing feature.

### 3. `i18n.locale` disagrees with `translate`/`messages` — the UI can name one language and show another

- `src/plugins/i18n.ts:57-66` (`locale`) resolves `override → native.preferredLocale() → options.locale ?? first key`; `:50-51` (`preferred()`, used by `messages`/`translate`) resolves `requested → override → options.locale → native`. `resolveCatalogue` then appends the configured default and first entry (`i18n-messages.ts:65`).
- Command `bun -e 'import {createI18nPlugin} from "./src/plugins/i18n.ts"; const p=createI18nPlugin({locale:"de",messages:{de:{greeting:"Hallo"},en:{greeting:"Hello"}},adapter:{preferredLocale:()=>"en"}}); console.log(p.commands.locale(),p.commands.translate({key:"greeting"}),p.commands.messages())'` → `locale {"ok":true,"locale":"en"}` but `translate {"ok":true,"locale":"de","text":"Hallo"}` and `messages` in `de`.
- The guide states one order (`site/app/docs/guides/i18n/page.mdx:33`: "the page's `setLocale` choice, then the configured `locale`, then the system's preferred language, then the first catalogue entry") while the code has two. A language picker reading `i18n.locale` shows English while the content is German.

### 4. No crust API into the WebView's accessibility tree

- `elementCount` walks the app's own AX element (`src/platform/darwin/accessibility.ts:114-120`, C unit `src/platform/darwin/shim/106_accessibility.c`), never `WKWebView` content. The guide is honest (`site/app/docs/guides/accessibility/page.mdx:115`: "`elementCount` walks the app's own element only").
- Genuinely absent: no command to read, name or focus an element inside the page's AX tree. A page can only speak a whole string through `announce` or rename the window through `title`.
- OS/WebKit limit: the content tree itself belongs to `WKWebView` and VoiceOver; crust neither configures nor verifies it. So a green `elementCount` is not evidence that a page is screen-reader accessible — it says nothing about web content.

### 5. Keyboard focus is window-level, not DOM-level

- `window.focus` is `makeKeyAndOrderFront:` (`src/platform/darwin/window-adapter.ts:74-75`); `accessibility.focus` sets `AXFocusedWindow`/`AXFocused` and posts changes (`src/platform/darwin/shim/106_accessibility_page.c:185-191`) — assistive focus, not keyboard focus.
- Genuinely absent: no DOM-element focus command, no tab-order API. A native menu item cannot move the caret into a specific control.
- OS limit: the menu bar and Tab order are AppKit/WebKit's; the parity page records that the Edit menu makes ⌘C/⌘V reach the webview (`site/app/docs/reference/parity/page.mdx:37`). A keyboard-only user gets the page as a plain web page; crust adds nothing and takes nothing away at DOM level.

## Honest already — do not re-report as defects

- Untrusted `announce` posts and lets the OS drop it: guide `site/app/docs/guides/accessibility/page.mdx:29`, C `shim/106_accessibility_page.c:105-133`, and `src/platform/darwin/accessibility-page.test.ts:50-55` claims only "reports the post", never a spoken string.
- Linux and Windows refuse `announce`/`title`/`focus` by name (`src/plugins/accessibility-requires.ts:28-73`), documented at `site/app/docs/guides/accessibility/page.mdx:51-61`.
- AX visibility is gated on app activation (`site/app/docs/guides/accessibility/page.mdx:94-107`), measured, not assumed.

## Top three

1. RTL: no `dir`/`lang` binding anywhere, templates hardcode `lang="en"`; Arabic/Hebrew pages render LTR and read as English.
2. Plurals: only `_one`/`_other` exist; six-category locales select `two`/`few`/`many`/`zero` and get the wrong string.
3. `i18n.locale` reports the system language while `translate` uses the configured one; the language indicator lies about the content.
