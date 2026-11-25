# 12 — logging

Field: `src/logging/**` (19 files, source and tests). Read-only hunt: no source file was changed.
Every claim below is labelled **measured** (I ran a probe against the real modules) or **read**.
Hunt-21's logging findings are already fixed in this tree; the items here are new.

## Medium — a page can forge lines in the human mirror with a newline in `msg`

- where: `src/logging/mirror.ts:19-21` (`humanLine`), `src/logging/mirror.ts:34-37`
  (`mirrorRecord`), `src/logging/records-page.ts:38-42` (console `msg`), `src/logging/record.ts:31`
  (`redactText` leaves newlines alone), `src/plugins/logging.ts:131-138` (`write` message).
- mechanism: `humanLine` interpolates `record.msg` raw. `pageRecord`'s console branch builds `msg`
  from `args.map(String).join(" ").slice(0, 400)` with **no whitespace collapsing**, and
  `redactText` only touches query strings, bearer/basic headers, cookies and JSON pairs. So a
  newline in a page-supplied console arg survives into the mirror. The same holds for `logging.write`,
  whose message is only `.slice(0, MAX_MSG_CHARS)`. `JSON.stringify` escapes the newline in the
  JSONL file, but the mirror prints one physical line per embedded `\n`. Hunt-21's "a page cannot
  inject a newline into the mirror" conclusion is no longer true for these two paths
  (`refuseRecord` and `page.error` still collapse whitespace, so they are clean).
- reachable by: **no capability for `page.console`** — the console tap is installed for every page
  and `POST /_crust/log` is the one ungranted write route. A page holding `logging:write` reaches it
  too. The forged text can carry a fake severity prefix (`ERROR platform platform.refuse …`) on
  stderr, which is exactly the stream a person redirects to a file to see failures.
- measured: a console record with arg
  `"done\n2026-01-01T00:00:00.000Z ERROR platform platform.refuse forged line"` produced
  `msg` with `includes("\n") === true` and `humanLine(...).split("\n").length === 2`; the same arg
  through a `log.write`-shaped record also produced 2 mirror lines. `JSON.stringify(record)` stayed
  on one physical line, confirming the leak is mirror-only.
- smallest fix: run page-controlled `msg` through the same one-line normaliser `oneLine` uses
  (`replace(/\s+/g, " ").trim()`) in `pageRecord`'s console branch and in `logging.write`, before
  `buildRecord`.

## Medium — a multi-cookie `Cookie:` header leaves every cookie after the first in clear text

- where: `src/logging/redact.ts:106` (`COOKIE`), `src/logging/redact.ts:111-118` (`redactText`).
- mechanism: `COOKIE = /\b(Cookie\s*:\s*)[^\r\n;]+/gi` stops at the first `;`. The replacement masks
  only the first cookie pair. The `QUERY` pass only matches `?`/`&`-prefixed keys, so a second
  `token=…`, `jwt=…` or `session=` after the semicolon is not redacted by any later pass.
- reachable by: any `msg` or string field that carries a full HTTP `Cookie` header — a page logging
  a failed `fetch` through `console`, an app logging an error response, or an `Error` stack line that
  includes request headers. The top-of-file comment promises "a credential hides in two places"
  and that message text stays broad; this shape is inside that promise.
- measured: `redactText("Cookie: session=sk-live-XYZ; token=abc123; jwt=eyJx")` returned
  `Cookie: [redacted]; token=abc123; jwt=eyJx` — two credentials in clear text.
- smallest fix: match the whole `Cookie:` value up to newline (or split on `;` and redact each
  `name=value` pair), e.g. `/\b(Cookie\s*:\s*)[^\r\n]+/gi`, keeping the header name.

## Low — query-string redaction misses `seed`, `sid` and `keychain`

- where: `src/logging/redact.ts:19-37` (`SECRET_WORDS`), `src/logging/redact.ts:74-103`
  (`QUERY_KEYS` / `QUERY`).
- mechanism: field-name redaction and URL-query redaction use two separate lists that have drifted.
  `seed`, `sid` and `keychain` are in `SECRET_WORDS` (so `isSecretName` masks a field with that
  name) but absent from `QUERY_KEYS`, so the same credential in `?seed=…`, `?sid=…` or
  `?keychain=…` inside a message is written verbatim. Hunt-21 fixed the missing `apiKey`/`jwt`/
  `refresh_token` spellings but left this second divergence.
- reachable by: a page console line containing a URL (`fetch("/x?seed=…")`), an app logging a
  request URL, or an `Error` message with a signed URL. All of those go through `redactText`.
- measured: `redactText("GET /x?seed=abc123&sid=def456&keychain=sk-live")` returned the string
  unchanged, while `isSecretName("seed")`, `("sid")` and `("keychain")` all returned `true`.
- smallest fix: derive `QUERY_KEYS` from `SECRET_WORDS` plus the camel/snake spellings, so the two
  passes cannot drift again.

## Low — page error messages exceed `MAX_MSG_CHARS`, and two caps are silent

- where: `src/logging/records-page.ts:38-42` and `:48-51`, `src/logging/record.ts:31`,
  `src/logging/types.ts:103-109`, `src/bridge/server/page-log.ts:32`.
- mechanism: `pageRecord`'s console branch slices `msg` to 400 with no truncation marker; its error
  branch does not cap at all. `buildRecord` calls `redactText(input.msg)`, which performs regex
  replacements but **no length truncation** — `redactValue`'s `MAX_STRING = 2000` cap applies only
  to field values. The route caps `body.message` to 4000, so a single page error writes a 4000-char
  `msg`. `logging.write` (`src/plugins/logging.ts:137`) also slices silently. This contradicts the
  stated invariant in `types.ts` ("Truncation is marked, never silent") and the 2000-char
  `MAX_MSG_CHARS` bound.
- reachable by: any page with an uncaught error whose message is over 2000 chars (no capability
  needed), or a page holding `logging:write`.
- measured: `pageRecord({kind:"error", message:"E".repeat(4000)})` fed to `buildRecord` gave
  `msg.length = 4000`; the real sink wrote a JSONL line whose parsed `msg.length` was also 4000.
  A console arg of 500 `z` characters ended with `zzzz…` and no `[truncated]` marker.
- smallest fix: route both page branches (and `logging.write`) through `cap(msg, MAX_MSG_CHARS)`
  from `records.ts`, which appends `…`, so the bound is enforced and visibly marked.

## Low — a `__proto__` field is silently dropped by the redaction walk

- where: `src/logging/redact.ts:160-167` (`redactValue`'s object loop),
  `src/logging/redact.ts:171-179` (`redactFields`).
- mechanism: `out[name] = next` uses ordinary assignment. When `name === "__proto__"` and `next` is
  an object, this replaces `out`'s prototype instead of creating an own field. The field is then
  invisible to `Object.keys` and `JSON.stringify`, so the caller's data disappears from the log.
  `buildRecord`'s later spread is safe (object spread creates a data property); the loss happens
  earlier, in `redactFields`.
- reachable by: a page console arg or app field deserialised from JSON with an own `__proto__` key.
  JSON.parse does create such a key, so this is reachable from the untrusted page path.
- measured: `redactFields(JSON.parse('{"__proto__":{"polluted":true},"ok":1}'))` returned
  `{"ok":1}` with `Object.hasOwn(out, "__proto__") === false`. No global prototype pollution
  resulted — the damage is silent data loss only.
- smallest fix: use `Object.defineProperty(out, name, { value: next, enumerable: true, writable: true,
  configurable: true })`, or build with `Object.create(null)`, so an own `__proto__` key survives
  redaction like any other.

## Checked and clean

- **Level gate (`src/logging/logger.ts:153-185`)**: `SEVERITY[input] > SEVERITY[active]` is the right
  comparison; `logEvent` returns before `state()` when nothing is configured, so a bare test does
  not create the real data directory; `configuredLogLevel` precedence (env over config) matches
  `level.test.ts`. `warnedBadEnv` warns once and falls back, as documented.
- **Rotation (`src/logging/rotate.ts:15-50`)**: `generations <= 1` deletes the target then renames
  the live file to `.1`; `>1` deletes generation N and shifts N-1…1 up. Missing generations are
  swallowed, a missing live file returns `undefined`, and `archivePath` keeps the extension.
  No off-by-one found.
- **Queue (`src/logging/sink.ts:67-88`)**: `queue.then(task, task)` keeps a rejected write from
  poisoning the next; `queue` is reset to a resolved promise on both paths; `tail` awaits the queue
  before reading. `write` converts every failure into `{ written: false, error }` and never rejects.
- **Errors subset (`src/logging/sink.ts:103-111`)**: the `record.source !== "page"` guard is intact,
  so a page warning cannot rotate away the framework's warnings; a failed error-file append is
  deliberately swallowed and reported as a successful app-file write.
- **Raw tail redaction (`src/logging/sink.ts:134-153`, `src/logging/record.ts:59-69`)**: an unparseable
  line is returned as `{ raw: redactText(...) }` only for an unfiltered read, and is capped at
  `RAW_LIMIT` 2000. The hunt-21 leak is closed.
- **Error stack redaction (`src/logging/redact.ts:150-158`)**: every retained stack line goes through
  `redactText`, including `stack[0]`, so a credential removed from `message` is not repeated in the
  stack. The regression test in `redact.test.ts:167-175` asserts this.
- **`tail` paging (`src/logging/sink.ts:120-154`)**: `limit` is clamped to `RING_SIZE`, the newest
  records win via `slice(length - keep)`, and `level`/`source`/`since` filters run before the slice.
  `sinceMs`'s malformed-value fallback (no floor) is the safe reading.
- **Mirror stream routing (`src/logging/mirror.ts:24-31`)**: warn → `console.warn`, error →
  `console.error`, trace/debug/info → `console.log`, and a non-dev mirror drops chattier-than-warn.
  Redirecting `2>` still carries failures only. (The newline-forging finding above is about line
  content, not stream choice.)
- **`logDirs` (`src/logging/paths.ts:33-40`)**: relative `dir` resolves under `root`, absolute `dir`
  wins, and `crust:os`'s `appLog` uses the same function, so the reported path cannot drift from the
  sink's path.
- **`app.ts` field order (`src/logging/app.ts:36-65`)**: `buildRecord` spreads caller fields first and
  core fields last, so an app field cannot overwrite `level`, `ts`, `pid` or `seq`. `tag` is a
  normal field and a caller-supplied `tag` in `fields` can override the subsystem tag, but that is
  the app's own trusted input, not a page boundary.
