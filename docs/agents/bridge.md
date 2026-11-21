# bridge lane — fix wave

Lane `bridge`, owns `src/bridge/**`, `src/runtime.ts` and their tests. Reports read:
`docs/reviews/defects-wave3/01-bridge.md` (8 findings) and `20-security.md` (4 findings).

An earlier occupancy of this lane wrote a report claiming the fixes were already in the tree but that
it had made no edits. At this lane's start the tree contained **unfixed** source for findings 1, 2, 4,
5, 6, 7 of `01-bridge.md` and 3 of `20-security.md`, no `server-guards.test.ts`, and no
`client-guards.test.ts`. Everything below was written and measured here.

## 01-bridge.md

1. Windows `%5c` traversal — **fixed** `src/bridge/server/assets.ts:31-37`: the `..` check splits on
   `/[\\/]/`, because `decodeURIComponent` runs before the check and `path.win32.join` treats `\` as a
   separator. `:43-57` adds containment: the candidate is `resolve`d and must equal the root or start
   with `root + sep`, otherwise `bad-request`.
2. `?window=` `<script>` breakout — **fixed** `src/bridge/client/bootstrap.ts:25-39,54`:
   `jsonForScript` escapes `<`, `>`, U+2028 and U+2029 before the config reaches the `<script>` body,
   so `</script>` cannot close the element. The JSON still parses to the same value.
3. `crust.ready` hangs after a failed invoke — **fixed** `src/bridge/client/invoke.ts:88-92`:
   `onAnswer()` now runs on any *completed* HTTP response, before the body is parsed and before the
   `ok` check. A transport throw still leaves `ready` pending, because the event stream can still
   open and answer; that is the documented meaning of the promise.
4. SSE cleanup leak — **fixed** `src/bridge/server/events.ts:57-70`: `detached()` deletes itself from
   `cleanups` before closing, so a disconnect retains nothing. `retainedCleanups` (`:84-90`) exposes
   the count for the test; the set is private otherwise.
5. Reserved-key collisions — **fixed** `src/bridge/server/bytes.ts:16-17,41-68` and
   `src/bridge/client/invoke.ts:37-67`. A data object whose own keys include `__crustBytes` or
   `__crustLiteral` is wrapped as `{ __crustLiteral: <object, values encoded one level down> }`, and
   the client unwraps it, walking only its values. Both walkers assign through
   `Object.defineProperty`, so a `__proto__` key survives as an own field instead of setting the
   prototype. `__crustLiteral` cannot be forged onto a real object: any object carrying it is itself
   wrapped, so a second unwrap level never exists.
6. Multibyte JSON bypasses the byte cap — **fixed** `src/bridge/server/invoke.ts:84-88`:
   `Buffer.byteLength(text)` replaces `text.length`, so the JSON branch measures wire bytes like the
   binary branch already did.
7. Raw SSE event name — **fixed** `src/bridge/server/events.ts:12-24`: `sseFrame` replaces `\r` and
   `\n` in the name with spaces, so a dynamic name cannot inject `data:`/`event:` lines or end the
   frame.
8. No boundary tests — **fixed** by three new suites: `src/bridge/server-guards.test.ts`,
   `src/bridge/client-guards.test.ts`, `src/bridge/dev-handshake.test.ts` plus additions to
   `server-events.test.ts` and `server-document.test.ts`. Cases listed under "tests added".

## 20-security.md

1. Token served by the token-free document route — **closed** by `fix-wave2` lane `token`. The
   document route now requires `?token=<token>` and answers `401` without it
   (`src/bridge/server/handler.ts`), `windowUrl` appends it (`src/app-loop.ts`), the page reads it out
   of `location.search` and the injected config no longer contains it
   (`src/bridge/client/bootstrap.ts:53-77`, `src/bridge/server/assets.ts`), and `window.create`
   appends the same token through `setBridgeToken` (`src/plugins/window-create.ts`).
2. Windows backslash traversal — same defect as `01-bridge.md:1`, **fixed** there.
3. World-readable dev handshake — **fixed**: the runtime writes `devHandshakePath()` in the OS temp dir with
   `{ mode: 0o600 }` and a following `chmodSync(file, 0o600)` tightens a file an earlier run created
   under a looser umask (`mode` applies only at creation).
4. Docstring claims an absent `Origin` is refused — **fixed** `src/bridge/server.ts:3`: it now says a
   *present* and foreign `Origin` is refused and an absent one is allowed, with the WebKitGTK
   `EventSource` reason, and names the document route as the pair of that bound.

## Tests added

- `src/bridge/server-guards.test.ts` (8 tests): `%5c` and `%2e%2e%5c` parent segments refused; a
  normal asset still loads; the HTTP route answers 400 and never the outside secret; malformed JSON
  400 `bad-json`; oversized body 413 `too-large`; a CJK body under the character count but over the
  byte cap 413 (that one fails on `text.length`); binary invoke with no query 400 `bad-request`.
- `src/bridge/client-guards.test.ts` (9 tests): a `</script>` label is escaped in the bootstrap and in
  a served document; `ready` resolves after a wrong token, after a handler throw and after a non-JSON
  reply; `__crustBytes` survives as a string; `__proto__` survives as an own field with an untouched
  prototype; a literal wrapper's other fields survive; `no-fetch` rejects.
- `src/bridge/dev-handshake.test.ts` (1 test): the temp handshake is mode `0600` and holds the
  bridge's own url and token, written into a temp project dir.
- `src/bridge/server-events.test.ts` (+2): three connect/disconnect cycles leave zero retained
  cleanups; `sseFrame` forces a multi-line event name onto one line.
- `src/bridge/server-document.test.ts` (+2): a foreign `Origin` gets 403 from `/` and from a
  client-side route, and the body never contains the token.

## Verification

- `bun test` on all nine bridge suites: **79 pass / 0 fail / 188 expect()**.
- `bun check src/bridge src/runtime.ts`: clean.
- `bun run check:lines`: every touched file at or under 200 (`src/runtime.ts` 187 is the largest).
- `bun fmt <each touched file>`: applied per file, never tree-wide.
- Not run, per BRIEF: full suite, `bun run e2e`, any build. `bun check` whole-tree reports one error in
  `src/packaging/extension-compile.test.ts:81` (`Cannot find name 'dylibSuffix'`) — lane `packaging`.

## Durable notes

- `assetBody`'s guard must decode **before** splitting, and split on both separators: a `%5c` segment
  is a traversal segment on Windows and one harmless segment to a `/`-only split.
- `JSON.stringify` is not safe inside a `<script>` body: `<`, `>` and U+2028/U+2029 must be escaped.
- The page client's two halves are serialised with `Function.prototype.toString()`, so any new helper
  in `install.ts`/`invoke.ts` must live inside the function body. `put` and `revive` are inner
  functions for that reason; a module-scope import would arrive `undefined` in the page.
- `writeFileSync(path, data, { mode })` applies the mode only when the file is created — a file left
  by an earlier run keeps its old bits, so a secret write needs the `chmodSync` as well.
- `bun test src/bridge/` runs at ~90 ms with a real `Bun.serve` per test; the whole suite is cheap
  enough to run after every edit, which is how the two failing first drafts were caught.

## Residual for the coordinator

1. **`20-security.md:1` is closed** by `fix-wave2` lane `token` — see the entry above. Nothing here
   needs a follow-up: the document route demands the token, every navigation URL carries it, and the
   page reads it from its own URL rather than from the HTML.
2. **`src/runtime.ts` sets `CRUST_BRIDGE_TOKEN` in `process.env`**, and `src/plugins/shell.ts` passes
   `process.env` to `Bun.spawn`, so a spawned shell can read the token. `src/cli/dev/frontend.ts`
   reads that variable, so removing it is not one line — and it is only set when `dev.url` exists
   (`crust dev`), so a built app never publishes it.
