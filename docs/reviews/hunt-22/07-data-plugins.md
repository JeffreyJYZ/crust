# Hunt 22 — data plugins (`fs`, `store`, SQLite/`database`, `stronghold`)

Scope read: `src/plugins/fs*.ts`, `store*.ts`, `database*.ts`, `stronghold*.ts`,
`window-persist-store.ts`, the runtime wiring in `src/runtime-plugins*.ts`, the corresponding guides,
and the hunt-21 predecessor `docs/reviews/hunt-21/12-persistence-crypto.md`.
`measured` means I ran a short Bun probe that wrote only to `mkdtemp` directories (or mocked
`node:os`/`node:fs/promises` in-process); `read` means source only. No repo file was changed except
this report. No Windows or Linux runtime is claimed.

## High — SQL `ATTACH DATABASE` escapes the name rule and the app data root

- where: `src/plugins/database.ts:89-96,116-160`; `src/plugins/database-args.ts:36-54`;
  `src/plugins/database-name.ts:39-87`; `site/app/docs/guides/database/page.mdx:29-38,46-51`
- mechanism: `(measured)` `readSql` validates only that `sql` is a non-empty string and `args` is an
  array, then the verbatim string reaches `db.prepare(sql)`. SQLite's `ATTACH DATABASE ? AS alias`
  takes an arbitrary absolute path as a **bound** parameter, so the `databaseFile` token rule and the
  canonical `contains(root, target)` check are both bypassed: they govern the main file, not files
  SQLite opens from SQL. On a writable handle the attached file is created and written outside the
  app root; on a `readonly: true` handle the attached file can still be **read**, so the documented
  "readonly is a real open" promise does not bound what the page can see.
- reachable by: a page calls `database.open({ name: "notes" })`, then
  `exec({ handle, sql: "ATTACH DATABASE ? AS escaped", args: ["<other app root>/notes.sqlite"] })`
  and `query({ handle, sql: "SELECT * FROM escaped.<table>" })`. Measured in two temp roots: the
  attach succeeded, `CREATE TABLE escaped.secret` + `INSERT` created `secret.sqlite` in a directory
  outside the declared root, and `SELECT` returned the inserted row. A readonly main handle read an
  existing outside database the same way (and, as expected, could not write it). No attackers,
  concurrent processes or special OS state were needed.
- smallest fix: refuse path-taking SQL before `db.prepare` (`ATTACH`/`DETACH`, and statements that
  name a filesystem path), and state in the guide that the boundary is per-connection, not global.
  A full fix maps any attached path through the same `databaseFile`/`contains` rule.

## Medium — every `database` statement runs synchronously on the bridge event loop

- where: `src/plugins/database.ts:116-160`; `site/app/docs/guides/files/page.mdx:3`;
  `research/bridge.md:216`; `research/bridge/traps.ts:100-117`
- mechanism: `(measured)` the handlers are declared `async` but call
  `db.prepare(sql).run/all/get(...)` directly. `bun:sqlite` in this build (Bun 1.4.5) exposes no
  async variant: `stmt.runAsync`, `allAsync` and `getAsync` are all `undefined`. This is the exact
  blocking-handler shape the repo measures in `research/bridge.md` — one slow invoke stalls every
  other invoke and the Cocoa pump — and `fs.ts:2` explicitly avoids it. A page-supplied recursive
  CTE or a large `query` is therefore an event-loop freeze, not a slow request.
- reachable by: any page calls `database.query` with a long-running statement while another invoke
  is pending. Measured: a `WITH RECURSIVE cnt(x) … x<2000000 SELECT sum(x)` statement took 173 ms;
  a zero-delay `setTimeout` scheduled just before it fired at 172 ms, i.e. after the query had
  finished, not before.
- smallest fix: execute statements in a worker thread (or chunk/cancel long statements). If that is
  not possible, document that `database` violates the bridge's "every command is async" rule and
  bound read result sizes.

## Medium — `exec` and `query` silently discard every statement after the first

- where: `src/plugins/database.ts:123,141,155`; `src/plugins/database-args.ts:36-54`
- mechanism: `(measured)` `db.prepare(sql)` compiles only the first statement of a multi-statement
  string; the rest is ignored rather than refused. The command still answers `{ ok: true }`, and
  `exec` reports `changes`/`lastInsertRowid` from that first statement alone. `query` likewise
  returns only the first result set. This is silent partial execution with a success verdict.
- reachable by: a page sends the natural schema-setup string
  `"CREATE TABLE a(x); INSERT INTO a VALUES (1);"` to `exec`. Measured through the plugin: the
  answer was `{ ok: true, changes: 0, lastInsertRowid: 0 }`, a following
  `SELECT count(*) FROM a` returned `0`, and `query({ sql: "SELECT 1 AS a; SELECT 2 AS b" })`
  returned only `[{ a: 1 }]`.
- smallest fix: reject multi-statement SQL before `db.prepare` (the same tokenizer check that can
  refuse `ATTACH`), or execute all statements and report the combined outcome.

## Medium — a concurrent `open` leaves a stronghold session with a stale snapshot; `set` answers ok but `get` lies

- where: `src/plugins/stronghold.ts:64,69-95,102-133,135-151,178-194`;
  `src/plugins/stronghold-concurrency.test.ts:99-113`
- mechanism: `(measured)` `open` replaces `session` at `:89` while `set`/`delete` capture
  `active = session` **before** taking the file lock (`:103`, `:154`). When `open` runs first and
  the mutation runs second, the mutation re-reads the file, commits under the same header, and then
  skips the session update because `session !== active` (`:127`, `:170`). The file holds the new
  entry, but `get`/`keys` read `active.file` from the `open` snapshot and report it missing. Hunt
  21's regression test checks a *fresh* instance after this race, so the lying session is invisible
  to the gate.
- reachable by: one page on one plugin instance issues `open` and `set` in the same turn
  (`Promise.all([open(), set({key:"k",value:"v"})])`, open first). Measured 5/5 runs: both commands
  answered ok, the on-disk vault held `k`, but `get({key:"k"})` answered
  `{ok:false, code:"not-found"}` and `keys()` answered `{ok:true, keys:[]}` until a later `open`.
- smallest fix: capture `active` inside the `withFileLock` callback, so a queued mutation that loses
  to `open` builds on the session `open` installed; or refuse the mutation when `session !== active`
  instead of committing under a session that will never see it.

## Medium — the runtime's `fs` scope store is machine-wide, so persisted grants cross app boundaries

- where: `src/runtime-plugins.ts:48,51-54`; `src/plugins/fs-scope.ts:84,139-158`;
  `src/runtime-plugins.ts:72-74,192-194` (contrast: the data plugins get `appRoot`)
- mechanism: `(measured)` `scoped()` builds `createFsPlugin({ allow: fs.scope })` with no `app` and
  no `root`, so `createFsScope` puts `scope.json` at
  `defaultStateRoot(options.app ?? "crust")/scope.json` — the same path for every crust app — while
  `store`, `database` and `stronghold` are built with this app's `appRoot`. Grants persisted by one
  app are merged into every other app's `current()` on first use, and `scopeRevoke` is reachable
  from a page in every app (`fs-scope.ts:186`), so one app's page can delete another app's persisted
  grant.
- reachable by: a host that persists a grant through `createFsScope().allow` (the documented host
  API) or `createFsPlugin({ grants: "page" })` in app A; app B, configured with a disjoint
  `fs.scope`, silently inherits the prefix. Measured with `node:os.homedir` mocked to a temp home:
  the runtime plugin for `app: "my-app"` had `scopeList.paths` equal to
  `["<home>/allowed", "<home>/secret"]` after I seeded only
  `<home>/Library/Application Support/crust/scope.json` with `<home>/secret`. No
  `my-app/scope.json` existed.
- smallest fix: build it like the data plugins —
  `createFsPlugin({ allow: fs.scope, app: appId, root: appRoot })` — so each app's persisted grants
  stay in its own root.

## Medium — `fs` authorizes a canonical path but reads and writes the caller's raw path (TOCTOU)

- where: `src/plugins/fs.ts:100-107,129-190`; `src/plugins/fs.ts:114-124`;
  `src/plugins/preview.ts:107-116` (the fixed pattern)
- mechanism: `(measured)` `scoped()` awaits `scope.check(value)` and then returns the **original**
  string. Every command uses that raw string for `Bun.file`, `Bun.write`, `readdir`, `rm` and
  `rename`, and `entrySize` checks a symlink's canonical target and then stats the raw link again.
  The scope result is discarded, so `..`/symlink resolution can be invalidated between check and
  use. Preview had this exact defect and was fixed by passing the canonical path to the surface;
  `fs` was not.
- reachable by: a path inside an allowed prefix that a same-user process (or an allowlisted `ln`
  through `shell`) repoints after the check. Measured deterministically in a temp tree: `link.txt`
  actually pointed to a file outside the only allowed prefix; with `node:fs/promises.realpath`
  stubbed so the check approved an in-scope target, `fs.readTextFile({ path: link })` returned
  `OUTSIDE`, the outside file's bytes. A live symlink-flip loop produced the same outside read on
  its first attempt.
- smallest fix: return `canonical(value)` from `scoped()` and use that returned path in every
  command, including `list`/`entrySize` — the same change preview already made.

## Low — store and stronghold reads are per-instance snapshots, so another instance's commit is invisible

- where: `src/plugins/store-scope.ts:46-53`; `src/plugins/store.ts:116-124,148-153`;
  `src/plugins/stronghold.ts:135-151,178-194`
- mechanism: `(measured)` writes re-read the file inside the shared file lock, but `get`/`keys`
  answer from a cache captured on first load (store) or from `session.file` captured at `open`
  (stronghold). A commit made by a second instance is not reflected until this instance writes
  something. In a running app the runtime builds one instance per namespace, so this is a host/test
  and multi-instance shape, not a single-page failure; it is recorded because the docs describe
  two instances over one file as a normal case.
- reachable by: two `createStorePlugin({ root })` instances on one root — A caches an empty store,
  B sets `seed`, then `A.get("seed")` answered `value: null` and `A.keys()` answered `keys: []`.
  Two stronghold instances over one vault — after A set `token`, `B.get` answered
  `{ ok:false, code:"not-found" }` and `B.keys()` answered `keys: []`, while a fresh instance saw
  `["token"]`.
- smallest fix: re-read under the same file lock on reads, or document reads as snapshot-isolated
  per plugin instance.

## Low — `withFileLock` keys on the raw path string, not the canonical file

- where: `src/plugins/store-file.ts:24-37`; used by `store-scope.ts:71`,
  `stronghold.ts:77,111,159`, `window-persist-store.ts:94-96`
- mechanism: `(read)` the queue map is keyed by the exact string passed in. Two roots that name one
  file through different case (APFS/NTFS are case-insensitive here) or a symlink get separate
  chains, so two "read-modify-write inside the lock" commits can still clobber one another. The
  per-app roots the runtime builds are identical strings, so a running app is unaffected; a host
  passing equivalent-but-different roots is.
- reachable by: `createStorePlugin({ root: "<case-variant>" })` and another instance with the
  canonical spelling, both writing at once.
- smallest fix: canonicalise the key before `fileQueues.get/set`, or key by `realpath` of the
  containing directory plus `basename`.

## Checked and clean

- **Store write serialization and corrupt quarantine**: `read` plus `measured`.
  `withFileLock` is module-scoped (`store-file.ts:24-37`) and `StoreScope.mutate` re-reads the file
  inside it (`store-scope.ts:70-79`), so two instances on one root do not drop each other's keys
  (`store-concurrency.test.ts:26-67`). `readStore` only reports `corrupt` after the rename succeeds
  (`store-file.ts:69-77`), and `store-corrupt.test.ts` pins the failed-rename and array cases. Not
  re-reported.
- **Store key and value handling**: `read`. `requireKey` rejects empty keys, `readName` types the
  optional name, `storeFileFor` refuses separators/`..` (`store-scope.ts:28-34`), `get` uses
  `Object.hasOwn` and writes use a computed key (`store.ts:122,132`), and `assertJsonValue`
  (`store-file.ts:95-140`) refuses cycles, non-finite numbers, holes and foreign prototypes. No
  prototype-pollution path found.
- **Stronghold crypto and file format**: `read`. PBKDF2-SHA256 with a fresh 16-byte salt, a sealed
  marker distinguishing a wrong password from an empty vault, AES-256-GCM with a fresh 12-byte IV
  per seal, HMAC-SHA256 `entry:<name>` ids, header floor/ceiling enforced before derivation, and
  `reloadFile` refusing a replaced header (`stronghold-file.ts:74-117,166-176`,
  `stronghold-crypto.ts:37-141`). `writeStore` writes 0600 and renames (`stronghold-file.ts:183-193`).
  No weak round, IV reuse or plaintext name found.
- **Stronghold per-app vault wiring**: `read`. `stronghold` is absent from the core `ALWAYS` list
  (`src/plugins/core.ts:37-47`) and built with `appRoot` on both runtime arms
  (`runtime-data-plugins.ts:14-21`, `runtime-plugins.ts:74,192-194`,
  `runtime-plugins-other.ts:104-106`). Hunt 21's shared-vault finding stays closed.
- **Database static name containment and parameter binding**: `read`.
  `databaseFile` refuses absolute paths, separators, `..` and non-token names, and
  `ensureDatabaseFile` re-checks the canonical path after `mkdir` (`database-name.ts:39-87`).
  A *static* symlink inside the root is still refused (`database-scope.test.ts:41-55`); the escape
  found here is through SQL, not the name. Every bound value reaches `stmt.run/all/get` as data —
  nothing is interpolated into the SQL string.
- **Database `readonly` engine enforcement**: `read` plus `measured`. `new Database(file, { readonly: true })`
  is a real engine-level read-only open (`database.ts:93-96`); a direct `INSERT` on such a handle
  fails. The ATTACH read above is a separate boundary problem.
- **Database handles**: `read`. Handles come from a `Map`, so `__proto__` cannot collide; `close`
  deletes the entry before `db.close()`, so a second `close` answers `unknown-handle`
  (`database.ts:68-84,108-114`).
- **fs scope fundamentals**: `read`. `canonical` resolves `..` the way the OS does and follows
  dangling links with a cycle guard (`fs-scope-path.ts:29-43`); `contains` respects path separators
  (`:45-49`); the store's own canonical path is refused before the unscoped shortcut
  (`fs-scope.ts:129-137`); config requires absolute prefixes (`config/validate-fs.ts:24-31`). The
  raw-path TOCTOU above is the remaining hole, not these checks.
- **fs argument and binary decoding**: `read`. Non-empty string paths, string contents, a real
  `Uint8Array` or a base64 `__crustBytes` tag with strict shape/length checks
  (`fs.ts:101-107`, `fs-binary.ts:45-70`); symlink sizes outside the scope are reported as 0
  (`fs.ts:114-124`).
- **Legacy vault note**: `read`. `noteLegacyVault` only logs a warning when a fresh per-app vault is
  created beside the old machine-wide file and does not read or copy its entries
  (`stronghold-legacy.ts:16-32`).
