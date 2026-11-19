# Hunt 50 — store / database field

Scope read: `src/plugins/store.ts`, `store-file.ts`, `store-scope.ts`, `database.ts`,
`database-name.ts`, `database-args.ts`, `database-types.ts`, `define.ts`, `errors.ts`,
`fs-scope-path.ts`, and the store/database tests. Focus: two writers on one file. All `measured`
claims below were run against the checked-out tree with Bun in temp directories; no source file was
changed.

## High — Case-differing store names share one physical file but get separate locks and caches

- where: `src/plugins/store-scope.ts:28-34` (name → path), `src/plugins/store.ts:103-110` (scopes
  keyed by name), `src/plugins/store-file.ts:24-37` (lock keyed by the path string),
  `src/plugins/store-scope.ts:70-78` (mutate).
- mechanism: `storeFileFor` allows `[A-Za-z0-9]` as the first character and keeps case, so `Alpha`
  and `alpha` produce two different strings `store.Alpha.json` / `store.alpha.json`. On macOS's
  default case-insensitive APFS these are the **same file** (the repo already folds case in
  `fs-scope-path.ts:57-61`, but the store path never uses that rule). `scopeFor` caches one
  `StoreScope` per *name*, so the two names get two scopes, two independent `entries` caches and two
  different `withFileLock` keys. The invariant `store-file.ts:20-22` claims — one lock per file — is
  false for this pair, and the read-modify-write in `mutate` races.
- reachable by: a page issues two named-store writes with names differing only in case:
  `Promise.all([store.set({name:"Alpha",key:"a",value:1}), store.set({name:"alpha",key:"b",value:2})])`.
  Measured: the file ended with only `{"fromAlpha":1}` in one run and only `{"fromLower":2}` in
  another — one key permanently lost. Even sequential writes are wrong for reads: with both keys on
  disk, `get({name:"Alpha",key:"fromLower"})` answered `value:null` while `get` via `alpha`
  answered `2`, because the two caches are never invalidated. On restart the case-`Alpha` reader
  would finally see the key, so the failure mode is silent in-session loss plus possible permanent
  loss under concurrency.
- smallest fix: canonicalise/fold the store name before both the scope-map key and the lock key, or
  derive the scope key from `samePath` of the resolved file; reject names that differ only by case
  on case-folding filesystems.

## High — The write lock is process-local, so two app processes lose writes to the same store file

- where: `src/plugins/store-file.ts:24` (`fileQueues` is a module-level map),
  `src/plugins/store-scope.ts:70-78` (read-modify-write), `src/plugins/store-file.ts:83-93`
  (temp + rename, with no mtime/inode compare before commit).
- mechanism: every process gets its own `fileQueues` map. Two processes sharing one app id write the
  same `store.json` with no mutual exclusion and no stale-write detection. This is the cross-process
  half of the lost-update bug hunt 20 fixed only in-process; the fix note there explicitly left
  mtime/inode retry undone.
- reachable by: launch two instances of the same crust app (no single-instance plugin required) and
  write different keys from each. Measured: two Bun processes, 25 disjoint `set` calls each on one
  root, left 25 of 50 keys on disk — one process's entire writes gone.
- smallest fix: before rename, compare the file's mtime/inode/size with the value read, and retry the
  whole read-modify-write on mismatch (or take an OS-level lock file).

## Medium — A second plugin instance's writes are invisible to the first instance's reads

- where: `src/plugins/store.ts:104-110` (one scope per name per instance),
  `src/plugins/store-scope.ts:47-53` (`loaded` caches forever), `:70-78` (`mutate` refreshes only its
  own scope's cache), `store.ts:122` / `:152` (get/keys answer from that cache).
- mechanism: `mutate` re-reads from disk inside the lock, so writes from two instances both reach the
  file, but `entries` is per-`StoreScope`. An instance that loaded before another instance wrote
  keeps its old snapshot and answers `null` / an old key list. `store.test.ts:51-55` only tests a
  *fresh* second instance, which reads from disk, so the stale case is untested.
- reachable by: two `createStorePlugin({root})` instances over one root, each `get` once to warm the
  cache, then `Promise.all([one.set({key:"from1",value:1}), two.set({key:"from2",value:2})])`.
  Measured: disk held `{"seed":0,"from1":1,"from2":2}`, but `one.get({key:"from2"})` answered
  `value:null` and `one.keys()` returned `["from1","seed"]`.
- smallest fix: invalidate or re-read caches when the file changes (mtime check in `loaded`), or key
  scopes by canonical path and share one scope per process.

## Low — Missing top-level args become `handler-error` (500) instead of `bad-request` (400)

- where: `src/plugins/store.ts:116-118`, `:125-127`, `:135-137` (`requireKey(args.key, ...)` runs
  after `forArgs(args)`, which tolerates `undefined`), `src/plugins/database.ts:89`
  (`{ name, readonly }: OpenArgs` destructures the arg directly), `src/bridge/errors.ts:78-82`.
- mechanism: with no argument object, `args.key` / the destructure throw a plain `TypeError`;
  `toCrustError` maps any non-`CrustError` to code `handler-error` with HTTP 500. The commands'
  own validators (`requireKey`, `databaseFile`) would have produced a structured `bad-request`
  with a message naming the field, and a page branches on `error.code`.
- reachable by: `store.get()`, `store.set()`, `store.delete()` or `database.open()` invoked with no
  args at all. Measured: all four answered `handler-error` with messages
  `undefined is not an object (evaluating 'args.key')` / `Cannot destructure property 'name' ...`.
- smallest fix: validate `args` as an object before touching its fields (`readName` already does
  this for `keys`/`clear`/`save`); have `open` read its fields through the same checked reader.

## Coverage

Read in full: the files listed in Scope above plus `store-concurrency.test.ts`,
`store-corrupt.test.ts`, `store-named.test.ts`, `database.test.ts`, `database-scope.test.ts`,
`store.test.ts`, `runtime-plugins.ts:40-70`, and the earlier reports
`docs/reviews/hunt-20/03-store-db.md` and `docs/reviews/defects-wave3/07-plugins-data.md`.
Probes (temp dirs only): two-instance two-writer staleness; case-colliding named stores, concurrent
and sequential; cross-process lost update; missing-argument error codes; `db.close()` after an
unfinalized statement and with a second handle on the same file (both clean).
Checked and clean: `withFileLock`'s chain/forget logic, corrupt-file rename-success reporting,
`assertJsonValue`, bound-parameter SQL, `readonly` open, name containment, and the
`__proto__` handling in store keys (previously reported clean and unchanged).
Not re-reported: an unreadable or directory-backed `store.json` still reads as empty (`store-file.ts:58`)
— pre-existing, already filed in hunt 20 item 3.
