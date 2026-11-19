# hunt-50 · observability that lies (13)

Scope: `src/plugins/accessibility*`, `src/plugins/i18n*`, `src/plugins/logging*`, `src/plugins/crash-reporter*`. Read-only review. Every claim below was reproduced with a local bun script against the working tree.

**Count: 5 findings** (1 high, 2 medium, 2 low). Worst is finding 1.

---

## 1 (worst) — i18n `locale()`, `setLocale()` and `load()` report a locale and `dir` no catalogue backs

- `src/plugins/i18n.ts:64-72` — `locale()` returns `preferred() ?? Object.keys(catalogue)[0]` without checking that the chosen locale exists in the catalogue.
- `src/plugins/i18n.ts:74-84` — `setLocale()` returns `dir: textDirection(locale)` for any non-empty string.
- `src/plugins/i18n.ts:120-125` — `load()` reports `locale: chosen` where `chosen = preferred() ?? available[0] ?? options.locale ?? "en"`, which need not be in `available`.
- `src/plugins/i18n-messages.ts:66-79` — `resolveCatalogue()` is what `messages()` and `translate()` actually use; it falls back to the language subtag, the configured default, then the first entry, and reports the locale it *found*.

`i18n.ts:61-63` states the invariant explicitly: "Same resolution as `translate` ... so the indicator cannot name one language while the text is in another." The resolution of *preferred* is shared, but the reported locale is not: `locale()` answers the raw preference, while `translate()` answers `found.locale` after fallback. Any preference absent from the catalogue breaks the invariant. This is not cosmetic: every result carries `dir`, and callers use it to set the document's `lang` and `dir` (`i18n-locale.ts:31-33`). A Hebrew or Arabic system preference with an English-only catalogue makes `locale()` answer `dir: "rtl"` while the text and `translate().dir` are `ltr`, so the page lays out and is pronounced in the wrong direction. `load()` is worse: it can report a locale that is not even in its own `available` array.

Reproduced: `createI18nPlugin({ locale: "de", messages: { en: { greeting: "Hello" } } })` gives `locale() => {locale:"de", dir:"ltr"}`, `messages() => {locale:"en"}`, `translate() => {locale:"en", text:"Hello"}`. With `loader: () => ({ en: {...} })` and the same `locale`, `load({directory}) => {ok:true, locale:"de", available:["en"]}`.

Reached: an app configures `locale`, or its `I18nAdapter.preferredLocale()` returns a tag, that its catalogue does not contain; or a page calls `setLocale` with such a tag; or `load()` reads a directory missing the preferred locale. All three are ordinary first-run and dialect-fallback paths. The existing tests (`i18n-locale.test.ts:91-105`, `i18n.test.ts:12-37`) only exercise cases where every reported locale is present in the catalogue, which is why this is uncaught.

---

## 2 — `logging.tail()` returns lines that were never written to the sink

- `src/plugins/logging.ts:167` — `ring.push(line)` happens before the `try` block that opens, rotates and appends to the file.
- `src/plugins/logging.ts:169-178` — `mkdir`, `rotateIfLarge()` and `appendFile()` are inside the `try`; any failure returns `{ written: false, reason: "sink-error", line, error }`.
- `src/plugins/logging.ts:180-184` — `tail()` slices that same ring and reports it as the log tail.

A line that failed the sink is kept in the ring and handed to `tail()` as if it were persisted. `write()` says `written: false`, but any consumer that reads logs through `tail()` alone — the documented reason the ring exists (`logging.ts:3-4`) — sees a record that is on no disk and vanishes on restart. The lie is silent and one-sided: the more broken the sink, the fuller `tail()` looks relative to the file.

Reproduced: `createLoggingPlugin({ root: "/dev/null/nope" })`, `write({level:"info", message:"never-on-disk"})` returns `{"written":false,"reason":"sink-error",...}` while `tail()` returns `{"lines":["1970-01-01T00:00:00.000Z INFO never-on-disk"]}`.

Reached: the log directory is unwritable or not a directory (sandboxed data dir, full disk, permission change, a path repointed by `configure` that cannot be created) and the page reads logs with `tail()`.

---

## 3 — `WriteResult.line` is documented as "the line as stored" but is returned when nothing was stored

- `src/plugins/logging.ts:57-59` — the field comment promises "The line as stored, present whenever it was formatted at all."
- `src/plugins/logging.ts:173` — on success, `line` is set alongside `path`.
- `src/plugins/logging.ts:177` — the sink-error branch returns the same `line` with `written: false` and no `path`.

This is the write reply counterpart of finding 2. A caller that keys off `result.line` to decide what to display or forward gets a formatted line for a record that failed to append. The shape invites that mistake: `line` is present in both outcomes, and only the less-visible `written` flag separates them. Same reproduction as finding 2.

Reached: any `sink-error` write; the caller branches on `line` rather than on `written`/`reason`.

---

## 4 — `crash-reporter.last()` / `list()` present an unreadable or corrupt store as "no crashes"

- `src/plugins/crash-reporter.ts:99-107` — with the guard running, `last()` returns whatever `readLastCrash(root)` gives and `list()` whatever `listCrashes(root, limit)` gives, with no read-status in the result type (`crash-reporter-types.ts:35-50` has only `crash`/`crashes` and `root`).
- `src/runtime-crash-store.ts:43-49` — `readLastCrash()` catches every read/parse error and returns `null`.
- `src/runtime-crash-store.ts:52-72` — `listCrashes()` catches a read error and returns `[]`, and silently drops any line that fails `JSON.parse`/`asStored` ("A torn line is not a crash; the next one still is.").

The plugin's whole stated contract is that a missing guard is *named*, not papered over (`crash-reporter.ts:2-4`). The same honesty stops at the store boundary: once the guard reports running, a permissions failure, a truncated write, or a corrupt `last-crash.json` is indistinguishable from a healthy app that has never crashed. A crash report that cannot be read is the one case a crash reporter must not silently swallow, and there is no field in `LastCrashResult`/`ListCrashesResult` that could express it.

Reproduced: with `guard: { running: () => true }` and malformed JSON in both `last-crash.json` and `crashes.log`, `last() => {crash:null, root}` and `list() => {crashes:[], root}`.

Reached: the store is on a volume that returns an I/O error, the files are not readable by this user, or a crash interrupts the append so a torn line / partial JSON is left behind (the writer at `runtime-crash-write.ts:88-100` does three non-atomic writes and a rotation). The page then reports "no crashes" for an app that has crashed.

---

## 5 — `accessibility.announce()` reports `ok: false` after the announcement was already posted

- `src/plugins/accessibility-page.ts:107-119` — `announce(text, priority)` and `adapter.trusted()` are awaited inside the same `try`; a throw from either goes to `refused()` at line 70-76, which returns `{ok:false, code:"handler-error"}`.
- `src/plugins/accessibility-types.ts:60` — `trusted()` is a native call (`AXIsProcessTrusted`) and is allowed to throw.

The post happens first. If the follow-up `trusted()` read throws, the handler discards the successful `AnnounceReport` and answers `handler-error`. The caller sees a failure for a notification the OS actually received, and the documented inspector fields (`announced`, `trusted`, `priority`, `reason`) are all lost. The two reads serve different purposes — one is the action, one is diagnostic context — so coupling their failure means a broken diagnostic API fakes a broken announcement.

Reached: an adapter whose `trusted()` throws (native AX call failure, or any app-supplied adapter that faults) while `announce()` succeeds. The `accessibility-announce.test.ts:132-143` "thrown adapter" case throws from `announce()` itself, not from `trusted()`, so this ordering gap is untested.

---

## Worst

Finding 1. The other findings misreport a single command's result; this one drives the document's `lang` and `dir`, so a wrong value changes layout and screen-reader pronunciation for the whole page, and it contradicts an invariant the code writes down in a comment. It fires on the ordinary path where the configured or system locale is missing from the catalogue, and `load()` can even report a locale absent from its own `available` list. Fix: make `locale()`/`setLocale()`/`load()` answer from `resolveCatalogue()` (the same function `messages()` and `translate()` use), so the reported locale and `dir` always name the table the app will actually read.
