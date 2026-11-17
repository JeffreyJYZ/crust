# Permissions lane

The capability model (`security.capabilities` + `security.grants`), deny by default once opted in,
checked once at the bridge invoke path.

## What landed

- `src/bridge/server/capabilities.ts` — `compileCapabilities` (config → per-label pattern lists,
  resolved once at bridge start) and `forbiddenMessage` (action, label, and the capability that would
  have allowed it). `no capabilities` compiles to a single `OPEN` object, so the allow-everything
  path costs one boolean read, not a map miss.
- `src/bridge/server/invoke.ts` — `createRunner` takes the compiled table and refuses **before** the
  handler runs, so both payload kinds (JSON and binary/query-string) share one gate and a plugin
  cannot forget it. `unknown-command` still wins over `forbidden`: an unregistered command answers
  404, because naming a non-existent command must not become an existence oracle.
- `src/bridge/errors.ts` — `forbidden` code, status 403.
- `src/bridge/server.ts`, `src/bridge/server/types.ts` — `StartBridgeOptions.security`, compiled
  inside `startBridge`.
- `src/runtime.ts` — passes `runConfig.security` into `startBridge`.
- `src/config/validate-security.ts` — by-name failures for an empty `actions`, a duplicate capability
  name, a bad action pattern, and a grant naming a capability that does not exist.
- Docs: `site/app/docs/guides/permissions/page.mdx`, two keys in
  `site/app/docs/reference/config/page.mdx`, `forbidden` in `site/app/docs/reference/errors/page.mdx`,
  nav entry beside Files.

## Decisions worth knowing

- **Action spelling is `plugin:command`.** The dotted `shell.spawn` is a config error, never a second
  spelling — two spellings for one action is how a grant looks right and covers nothing.
- **Matching reuses `patternMatches` with `caseInsensitive: false`.** The network matcher folds case
  on darwin/win32 because there the *filesystem* folds; a command name does not. Using it verbatim
  would have made `FS:read*` match `fs:readTextFile`, which is a silent widening on two platforms
  and not on the third.
- **A request with no window label holds nothing** once capabilities exist. Anything else makes the
  label optional and the whole grant table decorative: a page would just omit it.
- **`app.invoke` stays ungated.** It is the app calling itself from `main.ts`, not a page.

## Traps

- The brief says the check belongs in `createRunner`, but `createRunner` is also used by nothing else,
  so the binary payload path is covered by construction — a second check in `invokeRequest` would be
  dead code. Asserted with a binary-body test rather than trusted.
- `forbidden` must be added to `CrustErrorCode` **and** `STATUS`; the `Record<CrustErrorCode, number>`
  makes a missing status a type error, which is why the two edits land together.

## Tests

- `src/bridge/capabilities.test.ts` — through a real bridge: no config allows everything (compat
  guarantee), empty list is open, unlisted command is 403 `forbidden` naming the action and label, a
  label with no grant holds nothing, no label holds nothing, a granted label reaches `fs:readTextFile`
  and is refused `test:secret`, and the binary payload path is gated identically.
- `src/bridge/capabilities-match.test.ts` — the matcher alone: `dialog:*` matches `dialog.openPanel`
  and not `dialogx.openPanel`, `fs:read*` covers reads not writes, an exact action matches only
  itself, an unknown grant name is dropped, and `covering()` names the capability for a refusal.
- `src/config/validate-security.test.ts` — a valid section, an empty section, empty actions, a
  duplicate name, the dotted action, a grant naming nothing, and an unknown key.

Each was proved to fail without the fix: deleting the `capabilities.allows` call in `invoke.ts`
reddens the bridge suite, and making `compileCapabilities` always return `OPEN` reddens five of its
eight cases.

## Not done, deliberately

Nothing in this lane touches `src/app.ts`, `src/app-loop.ts` or `src/bridge/window-identity.ts` —
the token lane owns those. `src/bridge/server.ts` and `types.ts` were already modified by that lane
when this work started; the edits here are additive (`security` option, `compileCapabilities` call)
and do not rewrite its changes.

## Follow-ups for the coordinator

- `bun run site:build` was not run (the fix-wave brief forbids a build); `check:links` passes at 52
  routes.
- `docs/agents/permissions-lane.md` is the only memory file written by this lane.
