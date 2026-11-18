# Lane L4 — fix-app-command-grants

## Decision

`app.invoke` is a dispatcher, not one action. The gate reads its `name` argument and checks
`app:<name>` (e.g. `app:notes.save`), so a narrow grant scopes one `app.command`. The wire action
`app:invoke` stays a second candidate, because the scaffolds grant it and existing apps that opted
into capabilities must keep working. A page holding only `app:notes.save` cannot call `notes.delete`;
the refusal names `app:notes.delete`. Once a label holds `app:invoke`, it still reaches all app
commands — that is an explicit broad grant, not a silent one.

## Where it lives

- `src/bridge/server/actions.ts` — `effectiveAction` / `candidateActions`; the only dispatcher map
  is `app.invoke` -> its `name` field. Imports `APP_NAMESPACE` from `app-types.ts` (type-only import
  of `server.ts` there, so no runtime cycle).
- `src/bridge/server/invoke.ts` — `createRunner` checks every candidate and names the finest in the
  `forbidden` message. F1's `authority`/`routing` split was left intact.
- `src/bridge/server/app-command-grants.test.ts` — exact grant, wildcard, missing name, legacy flat.
- `src/config/validate-security.test.ts` — `app:notes.save` is a valid `plugin:command` action; the
  dotted `notes.save` (no colon) is still refused.

## Traps measured

- The brief's literal prove grant `app:notes.*` cannot scope by name: `patternMatches` treats `*` as
  matching any suffix, so it covers `notes.delete` too. Exact actions are the only per-command grant.
- The binary invoke path carries no JSON `args`, so `effectiveAction` falls back to `app:invoke`
  there. A narrow grant refuses it; a legacy flat grant allows it and the handler rejects the shape.
- No docs were edited: `site/app/docs/**` is F5's area. The permissions and typed-IPC guides still
  need a row saying app commands are granted as `app:<name>` and that `app:invoke` is the flat alias.

## Proof

- `bun test src/bridge/server/app-command-grants.test.ts src/bridge/capabilities.test.ts src/bridge/capability-binding.test.ts src/config/validate-security.test.ts` — 26 pass.
- `bun check` — no type errors in 780 files.
- `bun run test` — 1781 pass, 0 fail on the final run; the first run showed 1 fail that did not
  reproduce and was not in this lane's files (other lanes were editing the same tree).
- `bun fmt --check` on the four touched files and `bun run check:lines` — pass.
