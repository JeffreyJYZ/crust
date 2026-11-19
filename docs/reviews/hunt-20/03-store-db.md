# Hunt 20 — store / database field

Scope read: `src/plugins/store*.ts`, `src/plugins/database*.ts`, plus the helpers they call
(`store-file.ts`, `store-scope.ts`, `database-name.ts`, `database-args.ts`, `database-types.ts`,
`fs-scope-path.ts`). All `measured` claims below were run against the checked-out tree with Bun;
`read` claims are from the source only.

## High — Concurrent `store` writes silently lose keys

- where: `src/plugins/store.ts:129-134` (set), `:139-145` (delete), `:153-165` (clear/save);
  `src/plugins/store-scope.ts:47-53` (`loaded`), `:65-68` (`persist`)
- mechanism: Each mutating command does `current = await store.loaded()` then writes a full
  replacement `{ ...current, [key]: value }`. The read-modify-write is never serialized. Two
  overlapping commands capture the same `current`; the last `persist` writes its whole snapshot and
  the other command's key is gone. `persist` only assigns `this.entries = next` *after* its
  `await`, so even a second load in the same instance returns the pre-write object.
- reachable by: A page issues two invokes without awaiting the first, e.g.
  `Promise.all([store.set({key:"a",value:1}), store.set({key:"b",value:2})])`. Measured on one
  plugin instance: after seeding `seed=0`, concurrent `set a` and `set b` left keys `["b","seed"]`
  and raw `{"seed":0,"b":2}` — `a` lost. Also reachable across windows / plugin instances sharing
  one data dir: two instances each wrote one key concurrently, raw ended `{"from1":1}` — `from2`
  lost. `clear`, `delete` and `save` have the same shape and the same race.
- smallest fix: Serialize mutations per store file (a per-`StoreScope` promise queue that `set`,
  `delete`, `clear` and `save` all enqueue), and re-read from disk at the start of each queued
  write so a second instance's commit is not clobbered. For true cross-process safety, compare the
  file's mtime/inode between load and rename and retry on mismatch.

## Medium — `recovered` is reported even when the corrupt file was not moved aside

- where: `src/plugins/store-file.ts:49-51`; `src/plugins/store-scope.ts:56-61`
- mechanism: On invalid JSON, `readStore` does `rename(file, \`${file}.corrupt\`).catch(() => undefined)`
  and returns `{ entries: {}, corrupt }` unconditionally. The failure of the rename is swallowed,
  yet the path is surfaced as `recovered` on the next answer. The page is told data was quarantined
  when it was not.
- reachable by: Any state where the rename cannot succeed while reads still work — e.g.
  `store.json.corrupt` already exists as a directory, or the data directory is read-only.
  Measured with a corrupt `store.json` whose `.corrupt` target was a directory: answer was
  `{value:null, recovered:"…/store.json.corrupt"}` while a follow-up read showed the original
  corrupt bytes still at `store.json`. Also measured with a read-only data directory: same
  `recovered` path reported, file untouched. Because the corrupt file stays, a fresh plugin on the
  next launch re-detects and re-reports the same "recovery" indefinitely.
- smallest fix: Have `readStore` report `corrupt` only after a successful `rename`; on failure,
  either omit `recovered` or return a distinct `recoveryFailed` field so the page is not told a
  move happened. Optionally refuse to overwrite a still-corrupt live file on the next persist.

## Low — Unreadable or directory-backed store file reads as empty, then gets overwritten

- where: `src/plugins/store-file.ts:38-39` (`readFile(...).catch(() => undefined)`), `:46-47`,
  `:57-67` (`writeStore` temp + rename)
- mechanism: Any `readFile` error (permissions, EISDIR) is treated as "no file", so the store
  answers `null` for every key with no sign that data exists. A later write creates a temp file and
  renames it over the target; on a directory target the rename throws a raw EISDIR (measured), and
  on a permission-denied file the rename can replace it, destroying the hidden contents.
- reachable by: External state only — a page cannot chmod or mkdir the data dir. Measured:
  `store.json` chmod 000 with `{"secret":"hidden"}` → `get("secret")` returned `null`, file intact
  until written. `store.json` as a directory → `get` returned `null`, `set` threw `EISDIR`.
- smallest fix: Distinguish `ENOENT` from other read errors; surface a typed refusal for a
  non-regular/unreadable store file instead of silently presenting an empty store.

## Checked and clean

- **Prototype collision in store keys** — `read` plus `measured`. `readStore` copies parsed entries
  with object spread and `get` uses `Object.hasOwn` (`store.ts:122`), and writes use a computed
  key (`store.ts:133`). Measured `set({key:"__proto__", value:{polluted:true}})`: stored and read
  back correctly (`PROTO_GET {"polluted":true}`), no global pollution (`({}).polluted === undefined`),
  and a reopened plugin read it back from `store.json`. Clean.
- **SQL parameter binding / injection** — `read` plus `measured`. `readSql` requires `args` to be an
  array and commands call `stmt.run/all/get(...bound)` (`database.ts:123,141,155`); SQL is never
  interpolated. `database.test.ts` asserts a quote-laden payload stays data. Additionally measured a
  named-parameter statement `VALUES ($a,$b)` with `args:["first","second"]` → row
  `{"a":"first","b":"second"}` (bound positionally as documented). Clean.
- **Database path containment** — `read` plus `measured` via `database-scope.test.ts` (symlink in
  root refused; escaping/malformed names refused by `NAME` + canonical `contains`). Names are a
  token, not a path. Clean.
- **`readonly` open is a real SQLite-level lock** — `measured`. After creating a db writable,
  `open({readonly:true})` succeeded; a direct write was refused (`attempt to write a readonly
  database`), and ATTACH of an existing writable DB followed by INSERT was also refused
  (`attempt to write a readonly database`), as was an ATTACH of `:memory:`. No read-only bypass.
- **Database cross-instance concurrency** — `measured`. Two plugin instances on the same file,
  concurrent INSERTs: both succeeded (`changes:1` each) and `SELECT` returned both rows — SQLite
  serializes writers, so no lost-update analogue of the store bug.
- **Database handle map** — `read`. `open` is a `Map<string, Database>` (`database.ts:68`), so
  handles like `__proto__`/`constructor` cannot collide with inherited keys; `close` deletes before
  closing and stale handles answer typed `unknown-handle`. Clean.
- **Database file as a directory** — `measured`. `open` fails cleanly with
  `sql-error: unable to open database file`; no hang, no false success.
- **Schema migration** — `read`. This is a raw SQL surface; there is no schema/migration layer in
  these files to drift. Not applicable.
