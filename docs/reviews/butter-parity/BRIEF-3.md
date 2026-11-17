# The two Butter plugins crust still lacks

Read `../fix-wave/BRIEF.md` for house rules. Source for reference: `~/dev/resources/butter-src`
(read-only — never run `bun install` or a build there).

## Why these two

A side-by-side of `butter-src/src/plugins/` (25 plugins) against our registry leaves exactly two
capabilities missing. Everything else is either built or the same thing under another name
(`autolaunch`→`autostart`, `globalshortcuts`→`shortcuts`, `crashreporter`→`crash-reporter`,
`findinpage`→`findinpage`, `singleinstance`→`single-instance`).

## Lane J — `database`, callable from the page

Butter's `database` plugin lets **the webview** open a named SQLite file and run SQL over the bridge:
`db.open`, `db.close`, `db.exec`, `db.query`, `db.get`. crust's parity row says "`bun:sqlite` in the
backend — via Bun", which is true and is not the same thing: a page cannot query a database at all,
and a page that wants a row must go through a command the app wrote.

- `src/plugins/database.ts`: `open(name, { readonly })` → `{ handle }`, `close(handle)`, `exec`,
  `query` (array of rows), `get` (first row or null). `bun:sqlite` underneath.
- **Containment first.** A name is not a path: it resolves inside the app's data directory, and
  `../`, an absolute path or a separator is refused by name. Butter passes a name straight to
  `join(dir, name)`; do not copy that — reuse `fs-scope-path` so one containment rule serves both.
- `readonly: true` must be a real SQLite read-only open, not a promise not to write.
- A statement that throws answers a typed `sql-error` carrying SQLite's message, never a rejected
  invoke with a stack.
- Bound parameters only: `args` is an array, and nothing is ever interpolated into SQL.

Files: `src/plugins/database.ts` + test, `src/plugins/barrel-*.ts`, `src/runtime-plugins.ts`,
a guide page, a parity row. If it outgrows 200 lines, split by responsibility.

## Lane K — `securestorage`, the OS keychain

Butter shells out to `security add-generic-password` / `find-generic-password`. crust has
`stronghold` — an AES-256-GCM file under a password the app supplies — which is a different thing:
the OS protects a keychain entry with the login session, and there is no password for the app to
lose. Our parity page has no row for it.

- `src/plugins/keychain.ts`: `set(service, account, secret)`, `get(service, account)`,
  `delete(service, account)`, `list(service)`.
- **darwin**: `SecItemAdd` / `SecItemCopyMatching` / `SecItemDelete` through the existing shim
  pattern — not `Bun.$` shelling to `security`, because an argument reaching a shell is how a secret
  lands in a process list, and Butter's own implementation has that shape.
- **linux**: no OS keychain in this project's scope — answer `not-implemented` naming
  libsecret/gnome-keyring rather than writing a plaintext file and calling it secure.
- **windows**: `CredWriteW` / `CredReadW` / `CredDeleteW` in `advapi32`, resolved at runtime like
  every other entry point.
- A missing credential answers `{ found: false }`, never an error: "not stored" is a normal answer.
- The parity row must say Linux is `not-implemented`, so nobody reads the table and assumes four
  platforms.

Files: `src/plugins/keychain.ts` + fake + test, shim parts for each platform, `src/runtime-plugins.ts`,
a guide page, a parity row.

## Proof

Each lane: own tests, `bun check`, `bun run test`, `bun fmt <files>`, `bun run check:lines`, and the
parity page row. Where a platform cannot do it, the row says so and the command refuses by name.
