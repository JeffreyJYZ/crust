# Next wave, lane 9 — api-design

Field: the developer-facing surface — config keys, plugin API, typed IPC, error shapes, CLI.
Scope: read-only review. No source was changed. Every finding cites `file:line` from the tree at
`0e8d2c2` and says how a developer reaches it. Ranked by how often a developer hits it.

Commands behind the claims (all from `~/dev/crust`):
`rg -n 'typedHost|typedClient|InvokeMap' src site templates`;
`rg -n 'app:invoke|capabilities|app\\.command' site/app/docs src templates`;
`rg -n 'minHeight|material' src/config site/app/docs/reference/config/page.mdx`.

Settled rows in `site/app/docs/reference/parity/page.mdx` are not re-litigated here.

## 1. Every app command is one capability action: `app:invoke` (highest frequency)

A developer writes `app.command("notes.create", …)` or `typedHost<Ipc>(app).command(...)`, then
follows `site/app/docs/guides/permissions/page.mdx:34-43` and grants `notes:*` or `notes.create`.
That grant covers nothing. App commands never become handler keys: they are reached through the
`app` namespace plugin, whose only wire handler is `app.invoke`
(`src/runtime-app-namespace.ts:20-31`). The bridge reads the action from that wire key
(`src/bridge/server/invoke.ts:43-50`, `src/bridge/server/capabilities.ts:29-31`), so the gate sees
`app:invoke`, never `notes.create`.

- `site/app/docs/guides/permissions/page.mdx:32-45` documents `plugin:command` patterns only; no row
  or sentence covers app commands. A developer cannot scope one app command from another: granting
  `app:invoke` grants every `app.command` the app registers, present and future.
- `site/app/docs/guides/typed-ipc/page.mdx:28-35` shows `typedHost` registration with no mention of
  capabilities. An app that opts into `security.capabilities` turns the bridge deny-by-default, so
  its newly typed commands start answering `forbidden` — the docs give no hint why.
- `site/app/docs/reference/config/page.mdx:89-94` and the parity page's capability rows describe
  per-command grants without this exception.
- Only the scaffolds get it right: `templates/default/crust.config.ts:8-14` and
  `templates/next/crust.config.ts:12-18` explicitly grant `app:invoke`. A developer who started from
  the guides rather than a template has no path to that knowledge.

Why it matters: the capability model's whole promise is "which command a page may call"
(`capabilities.ts:1-3`). For the recommended typed-IPC path that promise is all-or-nothing. The
smallest honest answer is a doc line in permissions/typed-IPC plus a per-command action check inside
`app.invoke` (or a documented `app:<name>` alias); it is not a redesign of the gate.

## 2. One concept, two return channels, and a third path that converts neither

`define.ts` offers `notImplemented(message, requires)` which **returns** `{ ok: false, code,
message, requires }` (`src/plugins/define.ts:49-51`) and `NotImplementedError` which **throws**
a `CrustError` (`:54-62`). Both plugins use both forms (`rg -n 'notImplemented\\(|NotImplementedError'
src/plugins src/*.ts`). Over the bridge both are converted to a 501 `not-implemented` rejection
(`src/bridge/server/invoke.ts:61-63`), matching `site/app/docs/reference/errors/page.mdx:18,32,36`.

The in-process path does neither. `App.invoke` calls the handler and returns its result unchanged,
with no `ctx` argument (`src/app.ts:122-126`). So a handler that returns `notImplemented(...)` and is
called from `main.ts` via `app.invoke` yields a resolved object the caller can mistake for data —
`ok: false` is only visible if checked. A plain `Error` likewise has no `code` there. `typed.ts:48-50`
documents the missing `ctx`, but nothing documents that error and not-implemented shapes change with
the calling path.

Rank: high for plugin authors; the two public symbols with near-identical names are the first thing
they reach for, and `isNotImplemented` (`define.ts:64-71`) is the only thing telling them which
channel a command used.

## 3. Two validated window config keys are missing from the config reference

`site/app/docs/reference/config/page.mdx:40-47` lists `label`, `url`, `width`, `height`, `minWidth`
and `title`. The validator accepts eight keys: `minHeight` and `material` are also real
(`src/config/validate-windows.ts:4-13,43-55`), and `WindowConfig` declares both
(`src/config/types.ts:16,19`).

- `minHeight` has no documented default or behaviour. `minWidth`'s row says "the configured
  `height` is reused as the minimum height" — a reader cannot tell whether setting `minHeight`
  overrides that or is ignored.
- `material` is platform-gated and refuses a value the current OS cannot apply by name
  (`validate-windows.ts:45-54`, `src/config/validate-material.test.ts:50-58`). It appears only on the
  parity page (`site/app/docs/reference/parity/page.mdx:92`), not in the config reference a developer
  starts from. The config page's opening promise — "unknown keys are rejected … so a typo is a
  launch failure" (`:3`) — makes a missing documented key read as an invalid one.

Rank: medium; config is read once per project, but `material` is exactly the key a developer copies
from a parity row and then needs the default/allowed-set for.

## 4. Page errors carry a code but no importable type or guard

The injected client throws `InvokeFailure` with `code`, `status` and optional `requires`
(`src/bridge/client/invoke.ts:32-44`), and `CrustInvokeError` is declared as the page-facing shape
(`src/bridge/client/types.ts:41-45`). Neither the class nor a type guard is exported from the
package root: `src/index.ts:1-42` has no `CrustInvokeError`. `site/app/docs/reference/errors/page.mdx:3`
says "Branch on `error.code`" but a page developer has no `crust` export to type a `catch` with and
`instanceof` cannot cross the bridge. The error is also named `CrustInvokeError` in the type but
`InvokeFailure` in the source, so `error.name` disagrees with the public type name.

Rank: medium-low; every error-handling page hits it, but a `code` string works at runtime.

## 5. Window and tray commands resolve `{ ok: false }` inside HTTP 200

`window` and `tray` failures are values, not rejections: `{ ok: false, code, message }`, with `label`
on window failures (`site/app/docs/reference/errors/page.mdx:50-72`). The obvious pattern —
`try { await invoke(...) } catch` — never fires. It is documented, but it sits beside the bridge's
rejection model and is a different shape from `notImplemented`'s `{ ok: false, ... }` value and from
`CrustError`'s rejection, so three failure shapes share one surface.

Rank: medium-low; high impact when hit, but the errors page does spell it out.

## What I did not report

The CLI parser (`src/cli/parse.ts`) names unknown options, conflicting directory arguments and
misapplied flags precisely; config errors name dotted paths (`src/config/issues.ts:22-28`); and
capability refusals name action, window and the covering capability
(`src/bridge/server/capabilities.ts:53-65`). Those were candidate "errors that do not say which
key" and are already correct. Typed IPC's two-argument app form is real: `install.ts:114-123`
distinguishes `invoke(name, args)` from `invoke(plugin, command, args)` at runtime.
