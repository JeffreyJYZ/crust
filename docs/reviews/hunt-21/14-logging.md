# 14 — logging

Field: `src/logging/**`, `src/plugins/logging*.ts`, `src/app-log.ts`. Hunt-20 had no logging lane, so
nothing here was previously reported.

Every claim below is labelled **measured** (I ran a probe against the real modules) or **read**.

## Medium — a page fills the disk with one invoke, and each line is written twice

- where: `src/logging/records.ts:36-52` (`invokeRecord`), `src/logging/records.ts:70-92`
  (`refuseRecord`), `src/plugins/logging.ts:128-133` (`write`), `src/bridge/server/invoke.ts:53`
- mechanism: `invokeRecord` builds `msg` from `ns` and `cmd`; `refuseRecord` builds it from `ns`,
  `cmd` and `detail`; `logging.write` passes the page's `message` through `String()`. All of those
  come straight from the page's JSON body (`invoke-request.ts:75-79` only type-checks them, and
  `effectiveAction` passes the page's `args.name` through as `detail`). Nothing truncates a composed
  `msg`: `redactValue`'s `MAX_STRING = 2000` cap applies to *field* values, never to the message
  string. So one `plugin: "p".repeat(1_500_000)` in a page's invoke body writes a 1.5 MB line — and
  because a failed invoke is a `warn`, `sink.write` appends the same 1.5 MB line to `errors.jsonl`
  too.
- reachable by: any page that can invoke at all, and **no capability is needed** — `ns` is logged
  before the handler is resolved, so even `unknown-command` writes it; with a `capabilities` list
  configured, a page holding no grants still gets a `refuseRecord` whose `ns`/`cmd`/`detail` are the
  page's own strings; and a page holding `logging:write` writes any `message` it likes. The body cap
  is 2 MB (`MAX_BODY_BYTES`), so one request can carry the payload.
- measured: `invokeRecord({ns:"p".repeat(1_500_000), cmd:"x", ok:false, code:"unknown-command"})`
  produced `msg.length = 1500035` and a 1 502 228-byte line; four such records gave
  `app.jsonl` 6 008 916 bytes and `errors.jsonl` 6 008 916 bytes, i.e. two files at once.
  `refuseRecord({ns:"d".repeat(300_000), cmd:<same>, detail:<same>})` gave `msg.length = 900024`
  with each field also 300 000 chars, so the refusal path is the same hole.
- smallest fix: cap the composed `msg` in `invokeRecord`, `refuseRecord` and `logging.write` (and in
  `oneLine`) to a few hundred bytes, and cap the `ns`/`cmd`/`detail` field lengths, the way
  `pageRecord` already caps `args` at 400 chars.

## Medium — an `Error` field redacts `message` but not `stack`, so the same secret leaks

- where: `src/logging/redact.ts:110-117`
- mechanism: `redactValue` handles `value instanceof Error` by returning
  `{ name, message: redactText(value.message), stack: value.stack?.split("\n").slice(0, 5) }`. The
  stack is passed through untouched, and the first stack frame is `"Error: " + message` — so the
  credential `redactText` just removed from `message` is written verbatim in `stack[0]`.
- reachable by: any app that logs an error object, which is the documented SDK shape
  (`log.error("sync failed", { err })`, the shape `app-logger.test.ts` uses), or the framework's own
  `logLifecycleError` path when a handler throws an `Error` whose message carries a URL with
  `?token=`. `new Error(\`GET ${url} failed\`)` is exactly that shape.
- measured: `redactFields({ err: new Error("GET https://api.example.com/v1/me?token=sk-live-SECRET-abc123 failed") })`
  gave `message` = `...token=[redacted] failed` while `stack[0]` still held
  `Error: GET https://api.example.com/v1/me?token=sk-live-SECRET-abc123 failed`; the serialized
  record contains the token. Confirmed through the real sink too: the line written to `app.jsonl`
  contains `sk-live-TOKENVALUE`.
- smallest fix: run `redactText` over each stack line (or drop `stack` when the message was
  redacted), the same way `pageRecord` builds `fields.stack` from a string that went through
  `redactFields`.

## Low — the name-based redaction misses the commonest credential field names

- where: `src/logging/redact.ts:16-56`
- mechanism: `SECRET_WORDS` is a curated list; `jwt`, `auth`, `session`, `sid`, `bearer` and
  `refreshToken` (as one word) are absent, and the compound test is `endsWith` on
  `apikey`/`privatekey`/`keychain` only. So `log.info("...", { jwt })`, `{ auth }`, `{ bearer }`,
  `{ sessionId }` write the raw value.
- reachable by: an app following the documented SDK (`log.info("request", { jwt })`), or any
  framework call site that puts one of these names in `fields`. The framework's own builders
  (`invokeRecord`, `refuseRecord`) use only `token`-family names today, so the exposure is the SDK
  surface, not the framework's own lines.
- measured: `isSecretName` returned false for `jwt`, `auth`, `bearer`, `sessionId`, `sid`,
  `refreshtoken`, `client_id`, `assertion`; true for `accessToken`, `idToken`, `setCookie`.
- smallest fix: add the missing words (`jwt`, `auth`, `session`, `bearer`, `assertion`) and make the
  compound test cover a name *containing* a secret word at a word boundary, not just three suffixes.

## Low — the text pass misses `?apiKey=`, `?jwt=`, `?refresh_token=`, `Authorization: Basic` and `Cookie:`

- where: `src/logging/redact.ts:62-68`
- mechanism: `QUERY` enumerates
  `token|key|secret|password|api_key|access_token|private_key|credential`. `apiKey` is not on it
  (the `=` must follow one of the listed names exactly), and `jwt`, `refresh_token` and `session`
  are not listed. `BEARER` covers only the word `Bearer`, and nothing covers a `Cookie:` header or
  an `Authorization: Basic <base64>` value — both are credentials in exactly the shape a page
  console line or an error message carries.
- reachable by: `redactText` runs over every `msg` and every string field, so a page that logs
  `fetch("/x?apiKey=...")` through `console.log`, or an app that logs a request URL, keeps the
  credential. `pageRecord` puts `console` args through `redactFields`, so this is the page path too.
- measured: `redactText` left `?apiKey=`, `?jwt=`, `?refresh_token=`, `authorization: Basic …` and
  `Cookie: session=…` untouched while redacting `?token=`, `?key=`, `?api_key=`, `?access_token=`,
  `?password=` and `Bearer …`.
- smallest fix: build the query-key alternation from `SECRET_WORDS` plus the camel/snake spellings,
  and add `Basic` and `Cookie` to the header pass.

## Low — `tail`'s raw path returns an unredacted credential from a truncated line

- where: `src/logging/sink.ts:135-140` and `src/logging/record.ts:56-66`
- mechanism: `tail` hands back `{ raw }` for any line that is not a record, up to `RAW_LIMIT` 2000
  chars, and the raw branch sits *before* the `level`/`source`/`since` filters, so an unfiltered
  `tail` (the default) returns it. The fragment is never passed through `redactText`, unlike every
  record field.
- reachable by: a crash or a full disk leaving a partial line (the docs already promise "one
  truncated write cannot hide the rest of the file", so the raw path is intended) whose bytes carry
  a credential — the commonest such line is a `bridge.invoke` record with `?token=` in a
  `detail`/`msg`, or any record with a secret-named field. A page holding `logging:tail` then reads
  it back verbatim.
- measured: writing `…,"seq":2,"token":"sk-live-RAWLEAK"` with no closing brace and calling
  `sink.tail({})` returned
  `{"raw":"{\"ts\":…,\"pid\":1,\"seq\":2,\"token\":\"sk-live-RAWLEAK\""}` — the token is in the
  answer.
- smallest fix: run the raw fragment through `redactText` before returning it, and apply the same
  filters a record gets (or at least the `since` floor).

## Low — `errors.jsonl` is a second copy of every warn, so a page's warnings are permanent

- where: `src/logging/sink.ts:92-98`, `src/logging/rotate.ts` (`ERRORS_GENERATIONS = 1`)
- mechanism: `errors.jsonl` is described in the docs as "the subset you attach to a bug report".
  It keeps `warn` and above, and every page `console.warn` is a `warn`. It rotates at the same
  `maxBytes` but keeps only one generation, so a page that emits a few large warnings rotates away
  the real warnings — the triage file is the one an attacker can most cheaply destroy.
- reachable by: a page calling `console.warn` in a loop (the console tap is installed for every
  page, no capability needed), or any app logging warnings faster than a person reads them.
- measured: three `warn` records from `source: "page"` produced three lines in `errors.jsonl`; four
  1.5 MB `bridge.invoke` failures (the Medium above) wrote 6 MB into `errors.jsonl` and rotated it
  once.
- smallest fix: keep `errors.jsonl` for framework warns only (drop `source: "page"`), or raise
  `ERRORS_GENERATIONS` to match `DEFAULT_GENERATIONS`.

## Checked and clean

- **Rotation chain (`rotate.ts`)**: `generations <= 1` deletes the target then renames the live file
  to `.1`; `generations > 1` deletes generation N then shifts N-1…1 up. A missing generation is
  swallowed by the `missing()` check, and a missing live file returns `undefined` rather than
  throwing. `errors.jsonl` uses `ERRORS_GENERATIONS = 1`, which the `<= 1` branch handles. No
  off-by-one found by reading; the archive name keeps the extension as documented.
- **Queue serialisation (`sink.ts:69-77`)**: one promise chain, `enqueue` chains
  `queue.then(task, task)` so a rejected task does not poison the next, and `queue` is reset to a
  resolved promise on both paths. `tail` awaits `queue.catch(...)` first, so a read after a write
  sees the write. `write` never rejects — every failure becomes `{ written: false, error }`.
- **Level gate (`logger.ts:159-171`)**: `SEVERITY[input] > SEVERITY[active]` is the correct
  comparison for "chattier than configured", and `logEvent` returns silently when no logger is
  configured, so a bare test does not create a real data directory. `setLoggerLevel` validates
  first and reports `changed` honestly.
- **`logDirs` containment (`paths.ts`)**: `dir` is resolved against `root` and an absolute `dir`
  wins — the validator (`validate-logging.ts:27`) refuses an absolute `dir` at config time, so the
  only absolute path into `logDirs` is a test adapter's. `appLog` in `crust:os` uses the same
  function, so the two cannot drift.
- **`logging.configure` boundary (`plugins/logging-configure.ts`)**: `resolve` collapses `..` first,
  `inside()` requires a separator boundary (a sibling whose name merely starts the root is refused),
  and `canonical()` resolves symlinks on every existing ancestor, so a symlink inside the root
  pointing outside is refused. I read the three cases the comment claims and they hold.
- **Mirror routing (`mirror.ts`)**: `warn` goes to `console.warn`, `error` to `console.error`,
  `debug`/`info`/`trace` to `console.log`, and a non-dev mirror only shows warn-and-above, so a
  redirected `2>` carries failures only, as documented. A page cannot inject a newline into the
  mirror: `msg` is built with `String(...)` and `JSON.stringify` escapes `\n` in the serialised
  record (measured: a `console` arg containing `\n` produced a `msg` with no newline).
- **Records paging (`sink.ts:122-146`)**: `limit` is clamped to `RING_SIZE`, the newest records win
  via `slice(length - keep)`, and `since`/`level`/`source` filters each drop non-matching records
  before the slice. A malformed `since` (`sinceMs` returning `undefined`) means "no floor", which is
  the safe reading.
- **`app-log.ts` summary**: `configSummary` emits counts only (`windows`, `plugins`, `capabilities`,
  `grants`, `version`), never capability action patterns or a window URL — the comment's claim
  matches the code. `ensureAppLogger` returns early under `NODE_ENV=test`, so a test process never
  writes into the real data directory.