# Hunt 21 — persistence and secrets

Scope read: `src/plugins/store*.ts`, `database*.ts`, `stronghold*.ts`, `keychain*.ts`, plus the
native keychain halves in `src/platform/{darwin,windows}/keychain*.ts` and their C shims.
`measured` means I ran a short Bun probe against the checked-out tree; `read` means source only.
No Windows or Linux runtime claim appears here.

## High — Concurrent `stronghold` writes across plugin instances drop secrets

- where: `src/plugins/stronghold.ts:59-65` (`serial`, a per-instance `queue`), `:98-125` (`set`),
  `:145-166` (`delete`). Contrast `src/plugins/store-file.ts:24-37` (`withFileLock`, module-scoped)
  which `store` uses in `src/plugins/store-scope.ts:70-79`.
- mechanism: `serial` serialises mutations only inside one `createStrongholdPlugin()` instance.
  Each instance holds its own `session.file.entries` snapshot from `open` and writes a full
  replacement `{...active.file.entries, [id]: entry}` to the same `stronghold.json`. Two instances
  on one file capture the same snapshot; the later atomic rename wins wholesale and the earlier
  key is gone. Both commands answer `{ok:true}`, and each instance's in-memory session still holds
  its own value, so the loss is invisible until a fresh `open`.
- reachable by: two plugin instances sharing a root (the exported `strongholdPlugin` uses
  `defaultStoreRoot("crust")`, so two crust apps with no id share one `stronghold.json`; the
  store tests already treat two instances on one root as a normal case). `measured`: seed one
  vault, open it with instances A and B, then `Promise.all([A.set({key:"alpha",value:"1"}),
  B.set({key:"beta",value:"2"})])`. The file held **1** entry, not 2; `A.get("alpha")` still
  answered `{"ok":true,"value":"1"}` and `B.get("beta")` answered `{"ok":true,"value":"2"}` —
  both lies. `delete` has the same shape. A concurrent `open` is also outside `serial`: it can
  replace `session` from disk mid-write, leaving a stale session whose next `set` drops the entry
  that was just committed.
- smallest fix: route `set`/`delete` (and `open`) through the module-scoped `withFileLock` that
  `store` already uses, keyed by the resolved vault path, and re-read/re-derive the entries inside
  the lock rather than mutating the `session` snapshot captured at `open`. At minimum, mirror
  `store-scope.ts`: re-read from disk inside the queued write and re-check the header before
  replacing it.

## High — The default `stronghold` registration shares one vault across every crust app

- where: `src/plugins/core.ts:38-46` (`strongholdPlugin` in `ALWAYS`),
  `src/plugins/stronghold.ts:54,189-190` (path from `defaultStoreRoot(options.app ?? "crust")`);
  contrast `src/runtime-plugins.ts:45,73-75` where `store` and `database` get `root: appRoot`.
- mechanism: `strongholdPlugin` is registered on every process from the core list with no adapter,
  so its file is always `~/Library/Application Support/crust/stronghold.json` regardless of the
  app id. `store`, `database` and (after hunt-20) `window-state` all receive the per-app root. Two
  crust apps therefore open the same encrypted file. Whoever writes its header first owns the
  password; the other app's `open` answers `bad-password` forever and there is no command to reset
  or delete a vault. If both apps use the same password, each reads the other's sealed entries.
- reachable by: install two crust apps that both enable the default `stronghold` namespace (it is
  in `ALWAYS`, so no config is needed). `measured`: instance A opened the shared root with `pwA`
  and stored `token=A-secret`; a fresh instance with `pwB` got
  `{ok:false, code:"bad-password"}`; a fresh instance with `pwA` opened it and `get("token")`
  returned `A-secret`. No concurrency or special configuration was involved.
- smallest fix: stop putting the bare `strongholdPlugin` in `ALWAYS`. Build it in
  `runtime-plugins.ts` with `createStrongholdPlugin({ root: appRoot })`, exactly like `store` and
  `database`, and pass it through `otherPlatformPlugins` for non-darwin. Keep a core fallback only
  if a page can be told which app's vault it reached.

## Medium — Windows keychain target names collide on `\` in a service or account

- where: `src/plugins/keychain.ts:62-71` (`nameOf` refuses NUL but not `\`),
  `src/platform/windows/shim/48_keychain.c:91-104` (`kc_target` joins as `service\account`),
  `:107-128,131-152,168-188` (set/get/delete/list all key on that joined target).
- mechanism: Windows keys one generic credential by a single target string built as
  `service + "\\" + account`. Nothing forbids a backslash inside either name, so different
  `(service, account)` pairs produce the same target: `("a", "b\\c")` and `("a\\b", "c")` both
  become `a\b\c`. `set` under the second pair overwrites the first pair's secret; `get` under either
  pair returns it. `list("a")` also matches both targets and reports both accounts, so enumeration
  is wrong for the same reason. The macOS half keeps service and account in two distinct
  `CFString` attributes and has no such collision.
- reachable by: a page passes a service or account containing `\` — legal because `nameOf` only
  checks non-empty and NUL. No concurrent access or special OS state is needed. `read` only: no
  Windows runtime exists here, so the C join and the absence of a backslash check are the evidence,
  not an execution.
- smallest fix: reject `\` in `nameOf` for the Windows adapter (or escape it in `kc_target` and use
  the same escaping in the prefix match of `shim_keychain_list`), and add a test that two different
  pairs with backslashes do not read the same secret.

## Low — Linux keychain silently truncates a secret containing NUL

- where: `src/plugins/keychain.ts:127-131` (only a non-string secret is refused),
  `src/platform/linux/cstring.ts:5-7` (`value\0` as a UTF-8 buffer),
  `src/platform/linux/shim/70_keyring.c:94-107,113-145` (`secret_password_storev_sync` and the
  lookup both take a NUL-terminated `const char *`).
- mechanism: the plugin deliberately allows any string as a secret, including one with an embedded
  `\0`. macOS and Windows pass exact address-plus-length bytes, so they store it intact. Linux
  hands libsecret a C string, so everything after the first NUL is discarded on write; the lookup
  returns the truncated copy. `get` answers `{ok:true, found:true, secret:"a"}` for a stored
  `"a\0b"` — a wrong secret reported as success.
- reachable by: a page calls `keychain.set` with a secret containing a NUL byte (a binary-ish token
  or a concatenation). `read` only — no Linux runtime claim. The plugin's own NUL rule applies to
  service/account names, not to the secret, and `cstring` keeps interior NUL bytes rather than
  escaping them.
- smallest fix: carry the secret as an explicit length on Linux too (a byte buffer plus length
  instead of `FFIType.cstring`), or refuse NUL in `keychain.set` on all platforms so the contract is
  uniform. Add a round-trip test for a NUL-bearing secret.

## Low — Windows `keychain.get` can return a truncated secret

- where: `src/platform/windows/keychain.ts:45-61`, C half
  `src/platform/windows/shim/48_keychain.c:130-152`.
- mechanism: the adapter probes with an 8 KiB buffer, re-reads at the reported length once, then
  decodes `Math.min(length, buffer.length - 1)` regardless. If the credential grows between the
  probe and that single re-read, `length` again exceeds the buffer and the decode silently emits a
  prefix. The macOS half (`src/platform/darwin/keychain.ts:57-75`) retries up to three times and
  throws rather than ever decoding a clamped prefix, for exactly this reason.
- reachable by: another writer updates the same credential between the two FFI calls (a concurrent
  app writing the same service/account, or a user editing it in Credential Manager). `read` only.
- smallest fix: mirror the darwin bounded retry — after the re-read, if `length` still exceeds the
  buffer, retry with a fresh exact buffer a bounded number of times and then throw.

## Checked and clean

- **Store write serialization within one file** — `read` plus `measured`. `withFileLock`
  (`store-file.ts:24-37`) is module-scoped, so two plugin instances on one root share a chain, and
  `StoreScope.mutate` re-reads the file *inside* the lock (`store-scope.ts:70-79`) instead of using a
  stale snapshot. `store-concurrency.test.ts:26-67` proves both the same-instance and
  two-instance cases; this is the fix hunt-20 asked for and it holds. Stronghold still needs the
  same treatment (High finding above).
- **Corrupt `store.json` quarantine** — `read` plus `measured`. `readStore` only reports `corrupt`
  after the rename succeeds (`store-file.ts:69-77`), and `store-corrupt.test.ts:30-78` covers the
  failed-rename case, the top-level-array case and one-shot reporting. No false "recovered" lie.
- **Store prototype keys and JSON validation** — `read`. `readStore` spreads into a fresh object,
  `get` uses `Object.hasOwn` and writes use a computed key (`store.ts:122,132`); `assertJsonValue`
  refuses cycles, non-finite numbers and foreign prototypes (`store-file.ts:95-140`). Hunt-20
  measured this; no new path found.
- **Stronghold KDF and file format** — `read`. PBKDF2-SHA256, a fresh 16-byte salt, a sealed marker
  to tell wrong password from empty, AES-256-GCM with a fresh 12-byte IV per seal, and HMAC-SHA256
  `entry:<name>` ids so names and equality patterns are absent from the file. The header floor and
  ceiling are enforced before any derivation (`stronghold-file.ts:79-90,97-115`,
  `stronghold-crypto.ts:107-114`), and `stronghold-kdf.test.ts` pins both bounds. No weak round,
  IV reuse or plaintext name.
- **Secret at rest and in messages** — `read` plus `measured`. `writeStore` writes 0600 and renames
  (`stronghold-file.ts:155-166`); the round-trip test asserts neither key nor value appears in the
  bytes (`stronghold.test.ts:155-197`). `reasonOf` on the keychain and stronghold failure paths only
  formats adapter/OS messages, none of which carry the secret, and the native halves never log.
  The keychain C units are written to temp as source code only — no secret is passed to a shell or
  a temp file.
- **Database binding and path containment** — `read`. `readSql` requires an array and binds every
  value through `stmt.run/all/get` (`database.ts:116-160`, `database-args.ts:36-54`); names are a
  token validated by `NAME` and re-checked with canonical `contains` after `mkdir`
  (`database-name.ts:39-87`). Handles are a `Map`, so `__proto__` cannot collide. Hunt-20 measured
  the SQLi and symlink cases; nothing changed.
- **Keychain name validation** — `read`. `nameOf` refuses empty and NUL-bearing service/account
  names (`keychain.ts:62-71`), so the C-string halves cannot have two names collapse through a
  terminator. The NUL rule does not cover secrets or Windows' `\` — see the two findings above.
- **Keychain enumeration** — `read`. Darwin builds a service-only attributes query and sizes account
  buffers from `CFStringGetLength` (`119_keychain_b.c:84-136`); Windows uses `CredEnumerateW` with a
  NULL filter so `*`/`?` stay literal (`48_keychain.c:168-188`); `splitAccounts` dedups and sorts.
  A missing `list` answers `not-implemented` naming the platform's API, never an empty array
  (`keychain.ts:175-186`). The prior "Windows list is not-implemented" defect is closed.
- **Carry-over, not a new finding**: an unreadable or directory-backed `store.json` is still read as
  empty and can be overwritten — re-checked and unchanged from hunt-20's `03-store-db.md` Low; not
  re-listed here.
