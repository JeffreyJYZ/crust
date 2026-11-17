# database-plugin lane

`crust:database` — page-facing SQLite (`open/close/exec/query/get`); Butter lets a webview query a
database, crust's parity row said "via Bun" only.

- Split by the 200-line cap: `database.ts` (commands), `database-name.ts` (name rule),
  `database-args.ts` (`readSql` + refusals), `database-types.ts` (shapes).
- Tests: `database.test.ts`, `database-scope.test.ts`, registration case in `runtime-plugins.test.ts`.
- Registered both `nativePlugins` arms, exported `barrel-data.ts`, `barrel.test.ts` list, parity row
  `same`, guide page + nav.
- **A bad name throws `CrustError` `bad-request`; a bad statement is a value `ok:false`,
  `code:"sql-error"`** — a test must `rejects.toMatchObject` on open, never read `.ok`.
- **`readonly` on a missing file refuses** (measured: `unable to open database file`).
- Containment is `canonical`+`contains` from `fs-scope-path.ts`, after `mkdir`, before the open.
- **`runtime-plugins.ts` is at the cap** — its comments are one long line each; a multi-line comment
  fails `check:lines`.
