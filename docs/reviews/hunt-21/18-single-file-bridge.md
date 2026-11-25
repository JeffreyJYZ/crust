# Hunt 21 — single-file mode and the page-side bridge

Field: `src/single-*.ts`, `src/vite.ts`, `src/bridge/client/**` (client, typed), `src/bridge/typed.ts`,
`src/bridge/page-console.ts`, `src/bridge/window-query.ts`.

`docs/reviews/hunt-20/01-bridge.md` covered the server half; its minting, token-revocation,
malformed-escape and vacuous-test items are skipped except where a page-side twin exists. Everything
below was re-derived from this tree, and four claims I started with were disproved by measurement and
are not in this file — they are named in "Checked and clean" so the next lane does not re-raise them.

## MEDIUM — a regex literal in a single file makes `hasDefaultExport` false, and the page loads blank

- where: `src/single-export.ts:10-72`
- mechanism: `codeOnly` is a character scanner that knows about `//`, `/* */` and three quote
  characters, but not about regex literals. A `/` that opens a regex is copied as code, and then the
  regex's own contents are read as source: `//` inside a regex (escaped or not) opens a line comment
  that blanks the rest of the line, and a quote inside a character class opens a string that blanks
  everything up to the next same quote. `hasDefaultExport` then answers `false`, so
  `buildPage` skips `requireReact` and `mountSource` and bundles the file as a side-effect module.
- reachable by: `measured`. `const q = /["']/;` on the line above `export default function P(){}`
  gives `hasDefaultExport` → `false` (the quote opens a string that swallows the export). So does
  `const re = /https?:\/\//; export default function P(){}` on one line (the `//` opens a comment).
  Built end to end through `detectSingle` + `buildPage`, that `app.tsx` produced
  `__crust_reload.txt, index.html, page.js` where `page.js` contains **no** `createRoot` and no
  `getElementById` — the document still carries `<div id="root">` and the module never mounts, so
  the window opens white and stays white, with no build error and no console message.
- smallest fix: make `codeOnly` skip regex literals (a `/` after `=`/`(`/`,`/`:`/`[`/`!`/`&`/`|`/`?`/`{`/`}`/`return` opens one), or drop the textual scan for `Bun.Transpiler`'s
  `scan`, which already knows the difference; and when no mount is found but the source does export
  a default, say so instead of silently bundling.

## MEDIUM — `typedClient` cannot call a plugin command, though `typed.ts` documents that it can

- where: `src/bridge/typed.ts:24-26,83-88`, `src/bridge/client/install.ts:129-132`,
  `src/runtime-app-namespace.ts:20-31`
- mechanism: `typedClient` calls `bridge.invoke(name, input)`, and the client's two-argument form
  always routes through the `app` namespace — `call(APP, "invoke", { name, args })`. The app
  namespace looks the name up in `app.#commands`, which only `app.command` writes. A map keyed by a
  plugin command (`"fs.readTextFile"`) therefore compiles, passes `typedClient`'s own tests, and then
  throws `unknown-command`. The same entry point is why a **string** input cannot work either:
  `invoke(name, command, args)` dispatches on `typeof command === "string"`, so a string input is read
  as the plugin form and `"greet"` becomes a plugin name.
- reachable by: `measured` against a real bridge. `typedClient<{ "notes.load": … }>().invoke("notes.load", {…})`
  → `handler-error: app.invoke plugin handler threw: crust: unknown command "notes.load"`.
  `typedClient<{ greet: { input: string } }>().invoke("greet", "x")` → `unknown-command: greet.x`,
  while the same call with `{ v: "x" }` answers normally. The doc at `typed.ts:22-26` says the
  opposite ("an app that only uses plugins can still write the map by hand with `"fs.readTextFile"`
  style keys … nothing here inspects the name"), so this is the documented path failing.
- smallest fix: give the app form its own method (or a non-string tag) so `invoke(name, args)` cannot
  be mistaken for `invoke(plugin, command, args)`; and have `typedClient` send a dotted name as the
  plugin form, or drop that claim from the doc and make the map app-commands-only.

## MEDIUM — under `crust dev` every window's page carries the same label's grants, whatever its label

- where: `src/runtime-host.ts:61-77`, `src/vite.ts:37-53`, `src/app-windows.ts:35`,
  `src/bridge/server/handler.ts:83-105`, `src/bridge/server/capabilities.ts:95-101`
- mechanism: a bridge-served window URL carries the process token, and the document route sees a
  seed token on a top-level navigation and **mints a per-label token** bound to its `?window=`. A
  dev-server page never goes through that route: `app-windows.ts:35` returns
  `withWindowLabel(devUrl, label)` with no token, and the Vite plugin injects the single
  `mintPageToken()` from `publishDevHandshake` — which is minted with no label, so it is bound to
  `DEFAULT_WINDOW_LABEL` (`"main"`). Authority comes from the token's bound label
  (`handler.ts:191`, `capabilities.ts:97`), never from the body's `window` hint.
- reachable by: `read` of all five files, plus `src/bridge/dev-handshake.test.ts:54-59`, which
  asserts that asking a minted token for `?window=admin` serves the document and mints nothing — i.e.
  the dev token cannot become `admin`. So with a `security.capabilities` table that grants something
  to `admin` and nothing to `main`, the built app's admin window can call it and the same window under
  `crust dev` is refused; with the grants the other way round, the dev page for *every* label runs
  with `main`'s authority. The capability model is the framework's authorization boundary, so a dev
  run that cannot reproduce it is a divergence an author will only discover after `crust build`.
- smallest fix: mint one document token per configured label in `publishDevHandshake` and have the
  plugin pick the token whose label matches the page's `?window=`; or state in
  `site/app/docs/guides/permissions/page.mdx` that a dev-server page always runs as `main`.

## LOW — a single file that only *documents* the `crust-security:` pragma is configured by its own text

- where: `src/single-detect.ts:33-57`
- mechanism: `SECURITY_PRAGMA` is matched with `exec` over the whole source and the **first** match
  wins. The anchor is `^\s*(?:\/\/|<!--)`, so any line whose first non-space characters are `//` or
  `<!--` qualifies — including one inside a `<pre>` block in an `.html` single file, which is exactly
  how a page would print the pragma as documentation.
- reachable by: `measured`. An `.html` single file containing
  `<pre>// crust-security: {"csp":"default-src 'self' 'unsafe-inline'"}</pre>` detects as an app
  whose `config.security.csp` is that string, so the page runs under a policy the author only meant
  to illustrate. A *malformed* example is refused loudly by `validateConfig`, which makes the valid
  one the dangerous case: it is accepted silently.
- smallest fix: require the pragma to be the file's first non-blank line, or skip a match whose line
  sits inside a `<pre>`/`<code>` element or a block comment; and name the rule in the error when a
  second `crust-security:` line is ignored.

## LOW — the console tap throws out of `console.log` for a value whose `toString` throws

- where: `src/bridge/page-console.ts:38-59`
- mechanism: `text` tries `JSON.stringify(value)` and, on a throw, falls back to `String(value)` —
  but that fallback is *outside* the `try`, so a value whose `toString` throws escapes `text`, escapes
  the patched `console[name]`, and the original `console.log` at line 58 is never reached. The entry is
  pushed after the loop that calls `text`, so it is not recorded either.
- reachable by: `measured` against `PAGE_CONSOLE_SOURCE` with a stub console and document.
  `console.log({ get toString() { throw new Error("nope") } })` threw `nope` out of `console.log`,
  `__crustConsole` stayed at 0 entries, and a following `console.log("after")` worked — so the tap
  silently loses the line and breaks the page's own logging call for that value. Any Proxy or
  lazily-throwing object reaches it; a circular object and `Object.create(null)` do not.
- smallest fix: wrap the `String(value)` fallback in its own `try` and return a placeholder, and push
  the entry before stringifying so a hostile value cannot lose the record.

## LOW — `crust.ready` resolves on a refusal, so a page cannot tell "no bridge" from "bad token"

- where: `src/bridge/client/invoke.ts:140-144`, `src/bridge/client/install.ts:42-52`
- mechanism: `onAnswer()` runs on any completed HTTP exchange, before the status or the body is read.
  A `401` (stale token), a `403 bad-origin`, a `404` from a dev server that is up but is not the
  bridge, and a `200` from a bridge with no handlers all resolve `ready`.
- reachable by: `read`. A `crust dev` page loaded before a runtime restart keeps the old handshake
  token (the bridge mints a fresh one per start and rewrites `.crust/dev.json`), so every invoke
  answers `unauthorized` while `await crust.ready` has already resolved — the page has no signal that
  reloading would fix it. The comment at `invoke.ts:141-143` argues a never-settling `ready` is worse;
  distinguishing the two answers the same concern without collapsing them.
- smallest fix: resolve `ready` only on a 2xx, or add a `firstFailure` field/promise carrying the
  first error while `ready` keeps its current transport-only rule.

## LOW — `once()` has no timeout, so a listener on an event that never fires is retained for the page's life

- where: `src/bridge/client/install.ts:115-121`
- mechanism: `once(event)` pushes a resolver into `waiters` and calls `call.attach(event)`; nothing
  ever removes it. `dispatch` only drains the list when the event actually arrives.
- reachable by: `read`. `await crust.once("fs.changed")` in a build where the watcher was never
  started, or on an event a capability grant refuses, leaves the promise pending forever with no error
  — the awaiting code simply never continues, which reads as a hang rather than a mistake.
- smallest fix: take an optional timeout that rejects with a named code and removes the waiter, and
  say in `CrustApi.once`'s doc that an event with no emitter never settles.

## LOW — `.crust/dev.json` is never removed, so a later dev run reads a stale or foreign handshake

- where: `src/runtime-host.ts:61-85`, `src/vite.ts:37-53`
- mechanism: `publishDevHandshake` writes `.crust/dev.json` (0600) and nothing ever deletes it —
  `rg 'dev\.json' src` finds only the writer, the reader and comments. The file is keyed by
  *project directory*, not by app id, and the plugin reads it whenever `CRUST_BRIDGE_URL`/`_TOKEN`
  are unset — which is the normal case, because the frontend is spawned before the runtime exists.
- reachable by: `read`. Two shapes, both ordinary. (a) A dev run that exits or crashes leaves the file
  behind; the next `crust dev` starts its runtime and rewrites it, but any page served in between is
  injected with a token no bridge will accept, and (per the `ready` finding) reports that as a working
  client. (b) Two apps in one project directory (`--config` each, different `app.id`, hence different
  `preferredPortFor` ports) share one `.crust/dev.json`: the last writer wins, and the first app's
  page invokes into the second app's bridge with the second app's `main` grants.
- smallest fix: include the app id (or the bridge port) in the handshake filename and have the plugin
  read the one matching its own `CRUST_BRIDGE_URL`, and delete the file when the runtime stops.

## Checked and clean

- **Dev handshake contents and file mode** (`src/vite.ts:37-53`, `src/runtime-host.ts:61-85`,
  `src/bridge/dev-handshake.test.ts`): `read`. It carries a minted document token, never the seed; the
  test asserts 0600 and that `?token=<minted>&window=admin` serves with no `location` header, so the
  page-side half of hunt-20's minting HIGH is closed.
- **`jsonForScript` escaping** (`src/bridge/client/bootstrap.ts:47-53`): `read`. `<`, `>`, U+2028 and
  U+2029 are escaped, and the served-document path is the only one that serialises a page-supplied
  value (the `window` label). `crust/vite` serialises only `{url, token}` from env, so there is no
  label to escape there. hunt-20's vacuous-test item has a real twin here and it is not vacuous: the
  escaping itself is covered by `bootstrapSource` tests, not only by the 401 path.
- **`withForcedWindowLabel` / `withoutWindowLabel`** (`src/bridge/window-query.ts:29-63`): `read`.
  Keys are compared decoded, so `%77indow=` is removed; the rest of the query stays byte-exact and the
  hash is preserved. This is the twin of hunt-20's minting finding and it holds.
- **`withToken` against a duplicate `token=`** (`src/bridge/window-identity.ts:147-158`): `read` and
  `measured`. A plain `?token=old` is replaced; a percent-encoded `%74oken=` is **not**, and
  `tokenFromSearch` decodes and returns the first one, so `withToken("/?%74oken=x", real)` yields a URL
  whose `tokenFromSearch` is `x`, not `real`. I chased this as a shadowing bug and it is not one: the
  attacker-supplied value has to name a token the ledger already issued, and a page that holds one can
  already use it — so this is a self-inflicted 401, not an escalation. Noted here so it is not
  re-reported as one.
- **Token never reaches the page world on darwin** (`src/bridge/client/install.ts:144-158`,
  `client/content-world.test.ts`): `read` plus the existing tests. The api object and
  `window.__CRUST__` both drop the token when `crustInvoke` exists, and a `replaceState` that refuses
  to scrub is covered by its own test.
- **Byte tagging and prototype safety** (`src/bridge/client/invoke.ts:56-85`): `read` plus
  `client-guards.test.ts:113-139`. `Object.defineProperty` for every key, `__crustLiteral` walked one
  level down, `__proto__` surviving as an own field.
- **`page-console` as an injection surface** (`src/bridge/page-console.ts:21-83`): `read`. The tap runs
  first in the page world, stringifies every argument, bounds the store at 500 and the relayed args at
  50, and dispatches one `crust:log` DOM event that the content-world script relays. A page that
  forges such an event can only write a record the route already accepts — `kind` is a closed set
  (`page-log.ts:18`), `message`/`stack`/`url` are length-capped, and `window` comes from the token's
  label, never the payload. That is log forgery, not a privilege boundary, and nothing claims it is one.
- **`POST /_crust/log` and the seed token** (`src/bridge/server/handler.ts:180-186`): `read` and
  `measured`. I reported the `?? token` fallback as a MEDIUM and it is not one: the process token is
  bound to `main` in `labels` (`server.ts:56`), so a page holding it can already invoke as `main`; the
  fallback grants nothing new. A random UUID is refused 401, and a minted document token works. The
  "page never chooses a level above the truth" comment at `page-log.ts:6-7` describes what the *tap*
  sends, not an enforcement the route promises.
- **Single-file `.html` dev has no reload poller** (`src/single-build.ts:71-79`): `read` and
  `measured` — the built `index.html` contains no `__crust_reload` fetch, and the marker is still
  written. That is documented on purpose at `site/app/docs/guides/dev/page.mdx:77-78`, so it is not a
  finding.
- **Single-file page origin** (`src/app-windows.ts:29-44`): `read`. I suspected a single-file window
  loaded from `file://` and was refused by the origin gate; it is not — `windowUrl` always builds an
  absolute `http://[IP_ADDRESS]:<port>/…` from the bridge, so the page is same-origin with the bridge
  and the POST passes. Not a finding.
- **Single-file extension refusal** (`src/single-build.ts:50-58`): `read`. An extension beside a
  single file stops the build with the project path, rather than building a page that would lose the
  extension at runtime; both the dev and build halves call it.
- **`hasDefaultExport`'s other shapes** (`src/single-export.ts`): `measured` across a table of
  preludes. A quoted string, an apostrophe in a JSX text node, a division, a `//` comment containing a
  quote, a template literal containing `export default`, and a block comment containing it all answer
  correctly. The regex-literal gap above is the one real hole in this scanner.
- **No suite, no build, no GUI probe was run.** The `measured` claims came from throwaway `bun`
  scripts under `/private/tmp` that imported the real functions, started a bridge on loopback, built a
  single file into a temp directory, and stopped the bridge before exiting.