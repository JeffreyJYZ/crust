# Lane B5 — parity-new-commands

One tree, no worktree. Owned file: `site/app/docs/reference/parity/page.mdx` only.

## What changed

- **Secure storage row** — was `partial — darwin same, linux not-implemented`. Corrected to `same`: Linux
  `set/get/delete` run through libsecret's synchronous API (`libsecret-1.so.0` + Secret Service provider);
  only `list` refuses by name on Linux (`secret_service_search_sync`) and Windows (`CredEnumerateW`).
  Proof cells name `src/platform/linux/keychain.test.ts` and `src/plugins/keychain-list.test.ts`.
- **Updater row** — added that `install`/`relaunch` answer `unsupported-platform` naming the platform on
  `win32`/`linux`. Proof adds `src/plugins/updater-platform.test.ts`.
- **Three new framework-guarantee rows** (each a capability Butter/Tauri has no command-shaped equivalent
  for): `App command grants`, `Typed failure status`, `Release assets`. Proof cells name
  `src/bridge/server/app-command-grants.test.ts`, `src/bridge/server/failure-status.test.ts`, and
  `scripts/release/targets.test.ts` + `scripts/release/release-workflow.test.ts`.
- Recounted the summary: 59 rows total (8 core, 35 plugin, 16 framework), 49 `same`, 1 `partial`,
  21 unlisted, 17 no-sweep `same` rows.

## Proof behind each Proof cell

- app grants: `app:notes.save` -> 200; `app:notes.delete` -> 403 naming `app:notes.delete`; flat
  `app:invoke` still reaches both (`app-command-grants.test.ts`).
- updater: both `install` and `relaunch` return `{ ok: false, code: "unsupported-platform" }` with the
  platform in the message for `win32` and `linux` (`updater-platform.test.ts`).
- Linux keychain: missing library throws naming libsecret and the package; status mapping to named
  errors; refused open does not latch (`src/platform/linux/keychain.test.ts`). `list` names
  `secret_service_search_sync` on Linux, not Windows' `CredEnumerateW` (`keychain-list.test.ts:65`).
- typed failures: refused `window.close` -> 404 while `window.list` stays 200, page client still
  resolves `{ ok: false, code: "unknown-window" }`; `resultStatus` maps unknown codes to 400
  (`failure-status.test.ts:25,51,58`).
- release assets: six targets including `bun-windows-arm64`, PE magic `4d5a`,
  `crust-<version>-windows-arm64.exe`, built on a native `windows-11-arm` runner
  (`targets.test.ts:58`, `release-workflow.test.ts:34`).

## Trap found

`src/plugins/keychain-registry.test.ts:41` still asserts the parity row contains both `not-implemented`
and `libsecret` — written when Linux keychain was absent. I do not own that test. The corrected row keeps
both strings honestly (Linux `list` **is** not-implemented and names a libsecret symbol), so the test
passes 5/5. Its test *name* is now stale; the keychain owner should retitle it to "list is
not-implemented on Linux and Windows" before claiming the row itself says Linux is absent.

## Gates measured

- `bun run check:parity` — PASS, `parity rows: 59 … check:parity PASS`; unlisted 21 matches the prose.
- `bun run site:build` — PASS, `/docs/reference/parity` prerendered.
- `bun run check:links` — PASS, 59 routes, every internal link resolves.
- Evidence bundle: `bun test` on 8 evidence files = 39 pass / 0 fail / 111 expects.
- `src/plugins/keychain-registry.test.ts` = 5 pass / 0 fail after the row rewrite.
- `wc -l site/app/docs/reference/parity/page.mdx` = 191 (under the 200 cap).
- `bun run check:lines` FAIL on two files outside this lane: `src/bridge/client/a11y-page.ts` (219) and
  `src/platform/windows/frames.ts` (215). Not mine — reported, not fixed.
