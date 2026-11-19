# hunt-50 · docs claims about `src/` that the code does not keep (48)

Scope: `site/app/docs/**/*.mdx` read against `src/`. Read-only inspection of `src/`; nothing there was
edited. Only `rg`/`fd` and file reads. Every finding below is a documentation claim, a code location
that contradicts it, and the ordinary path that reaches the contradiction.

**Count: 4 findings** (1 high, 2 medium, 1 low). Worst is finding 1.

---

## 1 (worst) — the platform contract is documented as five required methods; the code requires six

- `site/app/docs/reference/platforms/page.mdx:10` — "A platform implements `Platform` and nothing more: `start`, `pump`, `createWindow`, `window`, `quit`. Five methods, one page loader."
- `site/app/docs/design/page.mdx:85` — "the five required methods `start`, `pump`, `createWindow`, `window`, `quit`, plus the optional `windowLabels?()` and `lifecycle?()` hooks".
- `site/app/docs/design/page.mdx:121-122` — "five required methods and two optional hooks".
- `src/app-types.ts:27-51` — `Platform` has **six** required methods: `start` (:28), `pump` (:29), `createWindow` (:30), `window` (:31), **`destroy` (:37)**, `quit` (:38). `destroy` is neither in the docs' required list nor in their optional list. Its own comment at :32-36 calls it non-optional: "a platform that cannot close one is a defect, not an optional extra; `quit()` drives this for every open label." Only `windowLabels?` (:44) and `lifecycle?` (:50) are optional — the docs get that half right.

All three doc pages enumerate `destroy` out of existence. This is the central cross-platform contract, so it is the worst finding: it is repeated in three places, and the omitted method is load-bearing rather than a spelling detail.

How reached: a developer implements a new platform from the documented five-method list. TypeScript refuses the result (`destroy` is a required member), and even if cast through, `quit()`/window-close never calls their `destroy`, so a closed window's label and native handle are never released — the exact failure the comment at `src/app-types.ts:32-36` says a platform must not have.

---

## 2 — the i18n answer shape omits `dir`, and the locale promise is false on the fallback path

- `site/app/docs/reference/api-app/page.mdx:44-49` — the command table gives `locale` → `{ ok: true, locale }`, `setLocale` → `{ ok: true, locale }`, `messages` → `{ ok: true, locale, messages }`, `translate` → `{ ok: true, locale, key, text }`.
- `site/app/docs/reference/api-app/page.mdx:51` — "The answer's `locale` is the one the lookup actually landed on."
- `src/plugins/i18n.ts:64-125` — every one of those four commands includes `dir` in its answer (`:67`, `:83`, `:92`, `:114`, `:124`). More importantly, `locale()` at `:64-72` computes `chosen = preferred() ?? Object.keys(catalogue)[0]` and never checks that `chosen` is in the catalogue, while `messages()`/`translate()` report `found.locale` after fallback (`:86-115`).

The docs promise both the wrong shape and an invariant the code does not keep. `dir` is not cosmetic: callers use it for the document's `lang`/`dir`, so a missing field in the documented shape understates what a page receives. The "landed on" promise is directly contradicted: the reported locale can be a raw preference with no catalogue entry while the served text comes from the fallback locale.

How reached: an app configures `locale`, or its `I18nAdapter.preferredLocale()` returns a tag, that its catalogue does not contain (a dialect or a system language the app has no strings for). `locale()`/`setLocale()` then report that absent tag and a `dir` derived from it, while `messages()`/`translate()` answer with a different, real locale and `dir`. The page lays out and is pronounced in one direction while the text is in another. The existing tests cited in `13-observability.md` exercise only catalogues that contain every reported locale, which is why this path is uncaught.

---

## 3 — `notification.requestPermission` is documented as returning a permission string; the shipped adapter can only refuse it

- `site/app/docs/reference/api-ui/page.mdx:21-24` — command table: `requestPermission | none | "granted" | "denied" | "unknown"`.
- `site/app/docs/reference/api-ui/page.mdx:28` and `site/app/docs/limits/page.mdx:87` — the same document's prose says `requestPermission` answers `not-implemented` because authorization is requested by `notify` itself. The table and the prose disagree; the code agrees with the prose.
- `src/plugins/notification.ts:97-105` — `requestPermission` returns `notImplemented(...)` when there is no adapter, or when the adapter lacks the status selector.
- `src/platform/darwin/notifications.ts:96-98` — `darwinNotificationAdapter()` binds only `post`. It has no `requestPermission` member, so in a running app the command always takes the `notImplemented` branch, with `requires: "-[UNUserNotificationCenter getAuthorizationStatusWithCompletionHandler:]"` (`src/plugins/notification.ts:100-102`).

`"granted" | "denied" | "unknown"` is the adapter hook's type, not an answer any shipped configuration produces. The table reads as a contract a page can branch on; it never fires.

How reached: any page calling `invoke("notification", "requestPermission")` in `crust dev` or a built app. The bridge returns a `not-implemented` rejection carrying `requires`, not one of the three documented strings. A caller following the table (e.g. branching on `result === "denied"`) never sees a match.

---

## 4 — the imports page's export inventory omits real `crust/plugin` exports

- `site/app/docs/reference/api/page.mdx:75-84` — the "plugin values", "factories" and "other constants" rows present the `crust/plugin` export surface, but omit `screenPlugin`, `createScreenPlugin`, `SCREEN_COMMANDS`, `DATABASE_SUFFIX`, `databaseFile`, `databaseRoot`, `ensureDatabaseFile` and `createDeepLink`.
- `src/plugins/barrel-platform.ts:35,37` — `createScreenPlugin` and `screenPlugin` are exported.
- `src/plugins/barrel.test.ts:15-118` — the checked-in export contract pins every omitted name: `DATABASE_SUFFIX` (:16), `SCREEN_COMMANDS` (:28), `createDeepLink` (:45), `createScreenPlugin` (:62), `databaseFile`/`databaseRoot`/`ensureDatabaseFile` (:73-75), `screenPlugin` (:106). The test at :124-127 fails if any of them disappears from the barrel.

The tables read as the list of importable values, so the omissions are wrong claims about `src/` — an exporter that the test suite treats as required is invisible in the docs.

How reached: a consumer following the imports page concludes the screen plugin (and the database/deep-link helpers) have no package export and either cannot use them or reaches into internal paths instead of `crust/plugin`.

---

## Worst

Finding 1. The other findings misreport one command's answer or one export list; this one misstates the required shape of every platform implementation, in three separate doc pages. `destroy` is required by `src/app-types.ts:37` and is the method `quit()` uses to close windows, so following the docs produces code that does not compile and, if forced, cannot close a window. Fix: add `destroy(label)` to the required list in `platforms/page.mdx:10`, `design/page.mdx:85` and `design/page.mdx:121`, and change "five" to "six" in all three (the two optional hooks stay as they are).
